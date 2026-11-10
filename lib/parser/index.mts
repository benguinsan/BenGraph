import { createHash } from "node:crypto";
import { opendir, readFile } from "node:fs/promises";
import path from "node:path";
import { isBuiltin } from "node:module";
import { Project, SyntaxKind, ts } from "ts-morph";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);

export type ImportKind = "import" | "re-export" | "dynamic-import";
export type ImportStatus = "resolved" | "outside" | "excluded" | "unresolved";

export interface ParsedFile {
  path: string;
  folder: string;
  lines: number;
  hash: string;
  module: "esm" | "commonjs" | "script";
  fanIn: number;
  fanOut: number;
}

export interface ImportRecord {
  from: string;
  specifier: string;
  kind: ImportKind;
  status: ImportStatus;
  target?: string;
  reason?: string;
}

export interface Edge {
  from: string;
  to: string;
  kind: ImportKind;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface ParseResult {
  version: 1;
  root: string;
  files: ParsedFile[];
  edges: Edge[];
  imports: ImportRecord[];
  coverage: {
    filesFound: number;
    filesParsed: number;
    filesSkipped: number;
    skipped: SkippedFile[];
    importsSeen: number;
    importsResolved: number;
    importsOutside: number;
    importsExcluded: number;
    importsUnresolved: number;
  };
}

export type StoredAnalysis = Omit<ParseResult, "version" | "root">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string { return typeof value === "string"; }
function isNumber(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0; }
function isKind(value: unknown): value is ImportKind { return value === "import" || value === "re-export" || value === "dynamic-import"; }
function isStatus(value: unknown): value is ImportStatus { return value === "resolved" || value === "outside" || value === "excluded" || value === "unresolved"; }

function isParsedFile(item: unknown): item is ParsedFile {
  return isRecord(item) && isString(item.path) && isString(item.folder) &&
    isNumber(item.lines) && isString(item.hash) && (item.module === "esm" || item.module === "commonjs" || item.module === "script") &&
    isNumber(item.fanIn) && isNumber(item.fanOut);
}

function isEdge(item: unknown): item is Edge {
  return isRecord(item) && isString(item.from) && isString(item.to) && isKind(item.kind);
}

function isImportRecord(item: unknown): item is ImportRecord {
  return isRecord(item) && isString(item.from) && isString(item.specifier) && isKind(item.kind) && isStatus(item.status) &&
    (item.target === undefined || isString(item.target)) && (item.reason === undefined || isString(item.reason)) &&
    (item.status !== "resolved" || isString(item.target)) && (item.status === "resolved" || isString(item.reason));
}

/** Validates a persisted analysis without inventing a replacement filesystem root. */
export function isStoredAnalysis(value: unknown): value is StoredAnalysis {
  if (!isRecord(value) || !Array.isArray(value.files) ||
      !Array.isArray(value.edges) || !Array.isArray(value.imports) || !isRecord(value.coverage)) {
    return false;
  }
  const coverage = value.coverage;
  const files = value.files;
  const edges = value.edges;
  if (!files.every(isParsedFile) || !edges.every(isEdge)) return false;
  const imports = value.imports;
  if (!imports.every(isImportRecord)) return false;
  if (!(isNumber(coverage.filesFound) && isNumber(coverage.filesParsed) && isNumber(coverage.filesSkipped) &&
    Array.isArray(coverage.skipped) && coverage.skipped.every((item: unknown) => isRecord(item) && isString(item.path) && isString(item.reason)) &&
    isNumber(coverage.importsSeen) && isNumber(coverage.importsResolved) && isNumber(coverage.importsOutside) &&
    isNumber(coverage.importsExcluded) && isNumber(coverage.importsUnresolved))) return false;
  const paths = new Set(files.map(file => file.path));
  return paths.size === files.length &&
    edges.every(edge => paths.has(edge.from) && paths.has(edge.to)) &&
    coverage.filesParsed === files.length && coverage.filesFound === files.length + coverage.filesSkipped &&
    coverage.filesSkipped === coverage.skipped.length && coverage.importsSeen === imports.length &&
    coverage.importsResolved === imports.filter(record => record.status === "resolved").length &&
    coverage.importsOutside === imports.filter(record => record.status === "outside").length &&
    coverage.importsExcluded === imports.filter(record => record.status === "excluded").length &&
    coverage.importsUnresolved === imports.filter(record => record.status === "unresolved").length &&
    imports.every(record => record.status !== "resolved" || paths.has(record.target ?? ""));
}

function isParseResult(value: unknown): value is ParseResult {
  return isRecord(value) && value.version === 1 && isString(value.root) && isStoredAnalysis(value);
}

export async function readParseResult(file: string): Promise<ParseResult> {
  const value: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!isParseResult(value)) throw new Error("Invalid parser result");
  return value;
}

export interface ParserAdapter {
  moduleForFile(file: string, isExternalModule: boolean): ParsedFile["module"];
}

export const fallbackAdapter: ParserAdapter = {
  moduleForFile(file, isExternalModule) {
    if (/\.(cjs|cts)$/.test(file)) return "commonjs";
    if (/\.(mjs|mts)$/.test(file)) return "esm";
    return isExternalModule ? "esm" : "script";
  },
};

/** Finds source candidates in selected directories and records source symlinks as skipped without following them. */
async function walk(root: string) {
  const found: string[] = [];
  const skipped: SkippedFile[] = [];
  /** Descends only into real, permitted directories, preventing symlink loops and keeping skipped paths relative to the root. */
  async function visit(directory: string): Promise<void> {
    const entries = await opendir(directory);
    for await (const entry of entries) {
      if (entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name)) {
        await visit(path.join(directory, entry.name));
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        found.push(path.join(directory, entry.name));
      } else if (entry.isSymbolicLink() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        skipped.push({ path: relative(root, path.join(directory, entry.name)), reason: "Symbolic link is not followed" });
      }
    }
  }
  await visit(root);
  return { candidates: found.sort(), skipped };
}

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function isInside(root: string, file: string): boolean {
  const distance = path.relative(root, file);
  return distance !== ".." && !distance.startsWith(`..${path.sep}`) && !path.isAbsolute(distance);
}

function readCompilerOptions(root: string, config?: string): ts.CompilerOptions {
  if (!config) {
    return { allowJs: true, resolveJsonModule: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext };
  }
  const read = ts.readConfigFile(config, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, {
    ...ts.sys,
    readFile(file) {
      // Downloaded config must never read files from the application's host.
      if (!isInside(root, path.resolve(file))) throw new Error(`Compiler configuration references a file outside the repository: ${file}`);
      return ts.sys.readFile(file);
    },
  }, path.dirname(config), { allowJs: true });
  if (parsed.errors.length > 0) throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  return { ...parsed.options, allowJs: true };
}

export function calculateDegrees(files: readonly ParsedFile[], edges: readonly Edge[]): Map<string, { fanIn: number; fanOut: number }> {
  const degrees = new Map(files.map((file) => [file.path, { fanIn: 0, fanOut: 0 }]));
  const pairs = new Set<string>();
  for (const edge of edges) {
    const pair = `${edge.from}\0${edge.to}`;
    if (pairs.has(pair)) continue;
    pairs.add(pair);
    const from = degrees.get(edge.from);
    const to = degrees.get(edge.to);
    if (from) from.fanOut++;
    if (to) to.fanIn++;
  }
  return degrees;
}

/** Parses a local directory into file facts, resolved import edges and coverage; invalid compiler configuration fails rather than guessing. */
export async function parseRepository(directory: string, adapter: ParserAdapter = fallbackAdapter, onSelected?: () => Promise<void>): Promise<ParseResult> {
  const root = path.resolve(directory);
  const { candidates, skipped } = await walk(root);
  await onSelected?.();
  const filesFound = candidates.length + skipped.length;
  const optionsByDirectory = new Map<string, ts.CompilerOptions>();
  function optionsForDirectory(directory: string): ts.CompilerOptions {
    const cached = optionsByDirectory.get(directory);
    if (cached) return cached;
    // Downloaded repository configs are runtime inputs, not application assets to deploy.
    const config = ["tsconfig.json", "jsconfig.json"].map(name => path.join(/* turbopackIgnore: true */ directory, name)).find(ts.sys.fileExists);
    const options = config ? readCompilerOptions(root, config) :
      directory === root ? readCompilerOptions(root) : optionsForDirectory(path.dirname(directory));
    optionsByDirectory.set(directory, options);
    return options;
  }
  optionsForDirectory(root);
  const project = new Project({ compilerOptions: readCompilerOptions(root), skipAddingFilesFromTsConfig: true });
  const files: ParsedFile[] = [];

  for (const absolute of candidates) {
    const file = relative(root, absolute);
    optionsForDirectory(path.dirname(absolute));
    if (/\.d\.(ts|mts|cts)$/.test(file)) {
      skipped.push({ path: file, reason: "Type declaration file" });
      continue;
    }
    let content: string;
    try {
      content = await readFile(absolute, "utf8");
    } catch (error) {
      skipped.push({ path: file, reason: `Read failed: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const source = project.createSourceFile(absolute, content, { overwrite: true });
    const folder = path.posix.dirname(file);
    files.push({
      path: file,
      folder: folder === "." ? "" : folder,
      lines: content.length === 0 ? 0 : content.split(/\r\n|\r|\n/).length - (content.endsWith("\n") || content.endsWith("\r") ? 1 : 0),
      hash: createHash("sha256").update(content).digest("hex"),
      module: adapter.moduleForFile(file, ts.isExternalModule(source.compilerNode)),
      fanIn: 0,
      fanOut: 0,
    });
  }

  const program = project.getProgram().compilerObject;
  for (let index = files.length - 1; index >= 0; index--) {
    const file = files[index];
    const source = project.getSourceFileOrThrow(path.join(root, file.path));
    const diagnostics = program.getSyntacticDiagnostics(source.compilerNode);
    if (diagnostics.length > 0) {
      const reason = diagnostics.map(diagnostic => {
        const location = source.compilerNode.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        return `Syntax error at line ${location.line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
      }).join("; ");
      skipped.push({ path: file.path, reason });
      files.splice(index, 1);
    }
  }
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  const selected = new Set(files.map((file) => file.path));
  const imports: ImportRecord[] = [];
  const edges: Edge[] = [];
  const edgeKeys = new Set<string>();
  function record(from: string, specifier: string, kind: ImportKind): void {
    const source = path.join(root, from);
    let status: ImportStatus;
    let target: string | undefined;
    let reason: string | undefined;
    if (isBuiltin(specifier)) {
      status = "outside";
      reason = "Node built-in module";
    } else {
      const options = optionsForDirectory(path.dirname(source));
      const resolved = ts.resolveModuleName(specifier, source, options, ts.sys).resolvedModule?.resolvedFileName;
      if (!resolved) {
        const extension = path.extname(specifier);
        if ((specifier.startsWith(".") || path.isAbsolute(specifier)) && extension &&
            !SOURCE_EXTENSIONS.has(extension) && !path.basename(specifier).startsWith(".")) {
          status = "excluded";
          reason = `Non-source import ${extension}`;
        } else {
          status = "unresolved";
          // A bare specifier can name a workspace package, so absence is not proof it points outside.
          reason = specifier.startsWith(".") || specifier.startsWith("/") ? "Module not found" : "Package or alias not found";
        }
      } else if (!isInside(root, resolved) || resolved.split(path.sep).includes("node_modules")) {
        status = "outside";
        reason = "Resolved outside repository";
      } else {
        const resolvedPath = relative(root, resolved);
        if (!selected.has(resolvedPath)) {
          status = "excluded";
          reason = skipped.find(file => file.path === resolvedPath)?.reason ??
            (SOURCE_EXTENSIONS.has(path.extname(resolved)) ? "Target excluded by directory selection" : "Target is not a source file");
        } else {
          status = "resolved";
          target = resolvedPath;
          const key = `${from}\0${target}\0${kind}`;
          if (!edgeKeys.has(key)) {
            edges.push({ from, to: target, kind });
            edgeKeys.add(key);
          }
        }
      }
    }
    imports.push({ from, specifier, kind, status, ...(target ? { target } : {}), ...(reason ? { reason } : {}) });
  }

  for (const file of files) {
    const source = project.getSourceFileOrThrow(path.join(root, file.path));
    for (const declaration of source.getImportDeclarations()) record(file.path, declaration.getModuleSpecifierValue(), "import");
    for (const declaration of source.getExportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (specifier !== undefined) record(file.path, specifier, "re-export");
    }
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
      const argument = call.getArguments()[0];
      if (argument?.getKind() === SyntaxKind.StringLiteral) {
        record(file.path, argument.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue(), "dynamic-import");
      } else if (argument?.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
        record(file.path, argument.asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral).getLiteralValue(), "dynamic-import");
      } else {
        imports.push({
          from: file.path,
          specifier: argument?.getText() ?? "",
          kind: "dynamic-import",
          status: "unresolved",
          reason: "Non-literal dynamic import",
        });
      }
    }
  }
  const degrees = calculateDegrees(files, edges);
  for (const file of files) {
    const degree = degrees.get(file.path);
    if (degree) { file.fanIn = degree.fanIn; file.fanOut = degree.fanOut; }
  }
  return {
    version: 1,
    root,
    files,
    edges,
    imports,
    coverage: {
      filesFound,
      filesParsed: files.length,
      filesSkipped: skipped.length,
      skipped,
      importsSeen: imports.length,
      importsResolved: imports.filter((item) => item.status === "resolved").length,
      importsOutside: imports.filter((item) => item.status === "outside").length,
      importsExcluded: imports.filter((item) => item.status === "excluded").length,
      importsUnresolved: imports.filter((item) => item.status === "unresolved").length,
    },
  };
}
