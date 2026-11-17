import { Node, Project, SyntaxKind } from 'ts-morph';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { FrameworkFacts } from './types.mts';
import { readRootFile } from './files.mts';
import { callable, exportsOf, literal, unwrap, type ParsedSource } from './syntax.mts';
import { reactRoles } from './react.mts';

const methods = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
const extensions = ['tsx','ts','jsx','js'];

async function configuration(root: string): Promise<{prefix: string; extensions: string[]; routes: boolean}> {
  const configs: string[] = [];
  for (const extension of ['js','mjs','ts','cjs','mts','cts']) {
    const text = await readRootFile(root, `next.config.${extension}`);
    if (text !== undefined) configs.push(text);
  }
  const defaults = {prefix:'', extensions, routes:true};
  if (!configs.length) return defaults;
  const unknown = {...defaults, routes:false};
  if (configs.length !== 1) return unknown;
  const project = new Project({useInMemoryFileSystem:true});
  const source = project.createSourceFile('/next.config.ts', configs[0]);
  if (project.getProgram().compilerObject.getSyntacticDiagnostics(source.compilerNode).length) return unknown;
  if (source.getDescendantsOfKind(SyntaxKind.CallExpression).length) return unknown;
  if (source.getStatements().some(statement => !Node.isImportDeclaration(statement) && !Node.isVariableStatement(statement) && !Node.isExportAssignment(statement) && !(Node.isExpressionStatement(statement) && Node.isBinaryExpression(statement.getExpression()) && statement.getExpression().getText().startsWith('module.exports =')))) return unknown;
  let value: Node | undefined = source.getExportAssignments().find(assignment => !assignment.isExportEquals())?.getExpression();
  const assignments = source.getDescendantsOfKind(SyntaxKind.BinaryExpression).filter(expression => expression.getLeft().getText() === 'module.exports' && expression.getOperatorToken().getKind() === SyntaxKind.EqualsToken);
  if (!value && assignments.length === 1) value = assignments[0].getRight();
  value = unwrap(value);
  if (value && Node.isIdentifier(value)) {
    const declaration = value.getSymbol()?.getDeclarations()[0];
    value = declaration && Node.isVariableDeclaration(declaration) ? unwrap(declaration.getInitializer()) : undefined;
  }
  if (!value || !Node.isObjectLiteralExpression(value)) return unknown;
  // shortcut: wrapped, mutated or computed config is omitted; extend only with proven static forms.
  if (source.getDescendantsOfKind(SyntaxKind.BinaryExpression).some(expression => expression.getOperatorToken().getKind() === SyntaxKind.EqualsToken && expression !== assignments[0])) return unknown;
  const result = {...defaults};
  for (const property of value.getProperties()) {
    if (!Node.isPropertyAssignment(property) || Node.isComputedPropertyName(property.getNameNode())) return unknown;
    const name = property.getName().replace(/^['"]|['"]$/g, '');
    const initializer = unwrap(property.getInitializer());
    if (['rewrites','redirects','i18n','exportPathMap','trailingSlash'].includes(name)) return unknown;
    if (name === 'basePath') {
      const prefix = literal(initializer);
      if (prefix === undefined || (prefix !== '' && (!prefix.startsWith('/') || prefix.endsWith('/') || /[?#]/.test(prefix)))) return unknown;
      result.prefix = prefix;
    }
    if (name === 'pageExtensions') {
      if (!initializer || !Node.isArrayLiteralExpression(initializer)) return unknown;
      const items = initializer.getElements().map(literal);
      if (!items.length || items.some(item => item === undefined || !/^[a-zA-Z.]+$/.test(item))) return unknown;
      result.extensions = items.filter((item): item is string => item !== undefined).sort((a, b) => b.length - a.length);
    }
  }
  return result;
}

function directive(statements: readonly Node[], name: string): boolean {
  for (const statement of statements) {
    if (!Node.isExpressionStatement(statement) || !Node.isStringLiteral(statement.getExpression())) break;
    if (literal(statement.getExpression()) === name) return true;
  }
  return false;
}

function pattern(segments: string[], app: boolean): string | undefined {
  if (segments.some(segment => /[%?#\\]/.test(segment) || (app && (segment.startsWith('_') || segment.startsWith('@') || /\(\./.test(segment))))) return undefined;
  const paths = app ? segments.filter(segment => !/^\([^()]+\)$/.test(segment)) : segments;
  if (paths.some(segment => /[()]/.test(segment) || (/[\[\]]/.test(segment) && !/^\[(?:\.\.\.)?[^\[\]/]+\]$|^\[\[\.\.\.[^\[\]/]+\]\]$/.test(segment)))) return undefined;
  return '/' + paths.join('/');
}

export async function nextFacts(root: string, sources: readonly ParsedSource[]): Promise<FrameworkFacts> {
  const config = await configuration(root);
  const roles = reactRoles(sources, false);
  const routes: FrameworkFacts['routes'] = [];
  async function sourceRoot(directory: string): Promise<string> {
    try {
      const entry = await lstat(path.join(root, directory));
      if (entry.isDirectory() || entry.isSymbolicLink()) return `${directory}/`;
    }
    catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error; }
    return `src/${directory}/`;
  }
  const appRoot = await sourceRoot('app');
  const pagesRoot = await sourceRoot('pages');
  for (const {path, source} of sources) {
    const add = (role: string) => roles.push({path, role});
    if (/(?:^|\/)(?:__tests__|tests|test)\//.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) add('test');
    if (directive(source.getStatements(), 'use server') || source.getDescendantsOfKind(SyntaxKind.Block).some(block => {
      const parent = block.getParent();
      return (Node.isFunctionDeclaration(parent) || Node.isFunctionExpression(parent) || Node.isArrowFunction(parent)) && directive(block.getStatements(), 'use server');
    })) add('server-action');
    const extension = config.extensions.find(extension => path.endsWith('.'+extension));
    if (!extension) continue;
    const stem = path.slice(0, -(extension.length + 1));
    if (/^(?:src\/)?(?:middleware|proxy)$/.test(stem)) add('middleware');
    if (/^(?:src\/)?instrumentation(?:-client)?$/.test(stem)) add('instrumentation');
    const exports = exportsOf(source);
    const hasDefault = (exports.get('default') ?? []).some(declaration => callable(declaration) || Node.isClassDeclaration(declaration));
    if (path.startsWith(appRoot)) {
      const segments = stem.slice(appRoot.length).split('/');
      const name = segments.pop();
      if (segments.some(segment => segment.startsWith('_'))) continue;
      if (name === 'layout' || name === 'template') add('layout');
      if (['loading','error','not-found','default'].includes(name ?? '') ||
          (segments.length === 0 && ['global-error','global-not-found'].includes(name ?? ''))) add('loading-error');
      if (['sitemap','icon','apple-icon','opengraph-image','twitter-image'].includes(name ?? '') ||
          (segments.length === 0 && ['robots','manifest'].includes(name ?? ''))) add('metadata');
      const route = pattern(segments, true);
      if (route === undefined) continue;
      if (name === 'page') {
        add('page');
        if (config.routes && hasDefault) routes.push({file:path, method:'GET', path: config.prefix + (route === '/' && config.prefix ? '' : route)});
      }
      if (name === 'route') {
        add('api');
        if (config.routes) for (const [method, declarations] of exports) {
          if (methods.has(method) && declarations.length === 1 && callable(declarations[0])) routes.push({file:path, method, path:config.prefix + (route === '/' && config.prefix ? '' : route)});
        }
      }
    } else if (path.startsWith(pagesRoot)) {
      const segments = stem.slice(pagesRoot.length).split('/');
      if (segments[0] === 'api') { add('api'); continue; }
      if (segments.length === 1 && ['_app','_document','_error'].includes(segments[0])) {
        add(segments.at(-1) === '_error' ? 'loading-error' : 'layout');
        continue;
      }
      if (segments.at(-1) === 'index') segments.pop();
      const route = pattern(segments, false);
      if (route === undefined) continue;
      add('page');
      if (config.routes && hasDefault) routes.push({file:path, method:'GET', path:config.prefix + (route === '/' && config.prefix ? '' : route)});
    }
  }
  return {framework:'nextjs', roles, routes};
}
