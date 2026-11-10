import assert from "node:assert/strict";
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseRepository, readParseResult } from "../lib/parser/index.mts";

const run = promisify(execFile);

test("does not read inherited compiler configuration outside the repository", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "cartograph-config-boundary-"));
  try {
    const root = path.join(parent, "repo");
    await mkdir(root);
    await writeFile(path.join(parent, "outside.json"), '{"compilerOptions":{"strict":true}}');
    await writeFile(path.join(root, "tsconfig.json"), '{"extends":"../outside.json"}');
    await writeFile(path.join(root, "main.ts"), "export const value = 1;");
    await assert.rejects(parseRepository(root), /outside the repository/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("counts source symlinks as skipped without following them or emitting their edges", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-symlink-"));
  try {
    await writeFile(path.join(root, "real.ts"), "export const value = 1;");
    await writeFile(path.join(root, "entry.ts"), 'import "./alias";');
    await symlink("real.ts", path.join(root, "alias.ts"));
    await symlink("missing.ts", path.join(root, "broken.ts"));
    await symlink(".", path.join(root, "loop"), "dir");
    const result = await parseRepository(root);
    assert.equal(result.coverage.filesFound, 4);
    assert.equal(result.coverage.filesParsed, 2);
    assert.equal(result.coverage.filesSkipped, 2);
    assert.deepEqual(result.coverage.skipped.map(file => file.path), ["alias.ts", "broken.ts"]);
    assert.ok(result.coverage.skipped.every(file => /symbolic link/i.test(file.reason)));
    assert.equal(result.imports[0]?.status, "excluded");
    assert.match(result.imports[0]?.reason ?? "", /symbolic link/i);
    assert.equal(result.edges.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("fails loudly on invalid compiler config even without imports", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-invalid-config-"));
  try {
    await writeFile(path.join(root, "main.ts"), "export const value = 1;");
    await writeFile(path.join(root, "tsconfig.json"), '{"compilerOptions":{"moduleResolution":"invalid"}}');
    await assert.rejects(parseRepository(root), /moduleResolution/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("resolves a static template import", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-template-"));
  try {
    await writeFile(path.join(root, "main.ts"), 'void import(`./leaf`);');
    await writeFile(path.join(root, "leaf.ts"), 'export const value = 1;');
    const result = await parseRepository(root);
    assert.equal(result.imports[0]?.status, "resolved");
    assert.equal(result.edges[0]?.to, "leaf.ts");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reports syntax failures and excludes their incoming edges", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-syntax-"));
  try {
    await writeFile(path.join(root, "main.ts"), 'import "./broken";');
    await writeFile(path.join(root, "broken.ts"), 'import { missing from "./main";');
    const result = await parseRepository(root);
    assert.equal(result.coverage.filesFound, 2);
    assert.equal(result.coverage.filesParsed, 1);
    assert.equal(result.coverage.filesSkipped, 1);
    assert.match(result.coverage.skipped[0]?.reason ?? "", /syntax.*line/i);
    assert.equal(result.imports[0]?.status, "excluded");
    assert.equal(result.edges.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("uses each package's nearest config for aliases", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-config-"));
  try {
    for (const pkg of ["one", "two"]) {
      const directory = path.join(root, "packages", pkg);
      await mkdir(path.join(directory, "src"), { recursive: true });
      await writeFile(path.join(directory, pkg === "one" ? "tsconfig.json" : "jsconfig.json"), JSON.stringify({ compilerOptions: {
        paths: { "@/*": ["./src/*"] }, module: "ESNext", moduleResolution: "Bundler",
      } }));
      await writeFile(path.join(directory, "src", "main.ts"), 'import "@/leaf";');
      await writeFile(path.join(directory, "src", "leaf.ts"), 'export {};');
    }
    const result = await parseRepository(root);
    assert.equal(result.coverage.importsResolved, 2);
    assert.deepEqual(result.edges.map(edge => edge.to), ["packages/one/src/leaf.ts", "packages/two/src/leaf.ts"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recognizes explicit ESM extensions without import or export syntax", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-module-"));
  try {
    for (const extension of ["mjs", "mts", "cjs", "cts"]) {
      await writeFile(path.join(root, `entry.${extension}`), 'console.log(1);');
    }
    const result = await parseRepository(root);
    assert.deepEqual(result.files.map(file => file.module), ["commonjs", "commonjs", "esm", "esm"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("parses real imports and reports a broken path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-parser-"));
  try {
    await mkdir(path.join(root, "src", "parts"), { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), [
      'import { value } from "./parts/value";',
      'export { value as other } from "./parts/value";',
      'const lazy = import("./parts/lazy");',
      "void value; void lazy;",
    ].join("\n"));
    await writeFile(path.join(root, "src", "parts", "value.ts"), "export const value = 1;\n");
    await writeFile(path.join(root, "src", "parts", "lazy.ts"), "export default 2;\n");

    const result = await parseRepository(root);
    assert.equal(result.coverage.filesFound, 3);
    assert.equal(result.coverage.filesParsed, 3);
    assert.equal(result.coverage.filesSkipped, 0);
    assert.equal(result.files.find((file) => file.path === "src/parts/value.ts")?.folder, "src/parts");
    assert.deepEqual(result.imports.map((item) => [item.kind, item.status]), [
      ["import", "resolved"],
      ["re-export", "resolved"],
      ["dynamic-import", "resolved"],
    ]);
    assert.equal(result.edges.length, 3);
    assert.equal(result.files.find((file) => file.path === "src/index.ts")?.fanOut, 2);
    assert.equal(result.files.find((file) => file.path === "src/parts/value.ts")?.fanIn, 1);

    await rename(path.join(root, "src", "parts", "lazy.ts"), path.join(root, "src", "parts", "renamed.ts"));
    const broken = await parseRepository(root);
    assert.equal(broken.imports.filter((item) => item.status === "unresolved").length, 1);
    assert.match(broken.imports.find((item) => item.status === "unresolved")?.reason ?? "", /not found/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI writes a result that reads back with the parser contract", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-parser-"));
  try {
    await writeFile(path.join(root, "entry.ts"), "export const value = 1;\n");
    const output = path.join(root, "analysis.json");
    const { stdout } = await run(process.execPath, ["--experimental-strip-types", "scripts/parse-repo.mts", root, "--out", output], {
      cwd: path.resolve(import.meta.dirname, ".."),
    });
    assert.match(stdout, /Files found: 1/);
    const result = await readParseResult(output);
    assert.equal(result.version, 1);
    assert.equal(result.files[0]?.path, "entry.ts");
    assert.equal(result.coverage.filesParsed, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("records computed imports without inventing targets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-parser-"));
  try {
    await writeFile(path.join(root, "entry.ts"), 'const name = "other"; void import(`./${name}`);\n');
    const result = await parseRepository(root);
    assert.equal(result.coverage.importsSeen, 1);
    assert.equal(result.imports[0]?.status, "unresolved");
    assert.match(result.imports[0]?.reason ?? "", /non-literal/i);
    assert.equal(result.edges.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolves a path alias and classifies assets and packages", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-parser-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      baseUrl: ".", paths: { "@/*": ["src/*"] }, module: "ESNext", moduleResolution: "Bundler",
    } }));
    await writeFile(path.join(root, "src", "main.ts"), [
      'import { value } from "@/value";',
      'import "./style.css";',
      'import fs from "node:fs";',
      'import React from "react";',
      'import "lodash.merge";',
      'import "fs";',
      "void value; void fs; void React;",
    ].join("\n"));
    await writeFile(path.join(root, "src", "value.ts"), "export const value = 1;\n");
    await writeFile(path.join(root, "src", "style.css"), "body {}\n");
    const result = await parseRepository(root);
    assert.deepEqual(result.imports.map((item) => item.status), ["resolved", "excluded", "outside", "unresolved", "unresolved", "outside"]);
    assert.match(result.imports[3]?.reason ?? "", /not found/i);
    assert.equal(result.edges[0]?.to, "src/value.ts");
    assert.equal(result.coverage.filesFound, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
