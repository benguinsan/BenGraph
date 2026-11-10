import assert from "node:assert/strict";
import test from "node:test";
import { coverageSummary } from "../lib/coverage.mts";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseRepository } from "../lib/parser/index.mts";

const coverage = { filesFound: 2, filesParsed: 2, filesSkipped: 0, skipped: [],
  importsSeen: 10, importsResolved: 3, importsOutside: 5, importsExcluded: 1, importsUnresolved: 1 };

test("coverage excludes known external imports and marks any missing graph facts as partial", () => {
  assert.deepEqual(coverageSummary(coverage), { consideredImports: 5, percentage: 60, partial: true });
  assert.equal(coverageSummary({ ...coverage, importsResolved: 5, importsExcluded: 0, importsUnresolved: 0 }).partial, false);
  assert.equal(coverageSummary({ ...coverage, importsResolved: 5, importsExcluded: 0, importsUnresolved: 0, filesSkipped: 1 }).partial, true);
});

test("zero known imports have an explicit zero denominator; partial coverage never rounds to 100", () => {
  assert.deepEqual(coverageSummary({ ...coverage, importsSeen: 0, importsOutside: 0, importsResolved: 0, importsExcluded: 0, importsUnresolved: 0 }),
    { consideredImports: 0, percentage: 100, partial: false });
  assert.equal(coverageSummary({ ...coverage, importsSeen: 100001, importsOutside: 0, importsResolved: 100000 }).percentage, 99.9);
});

test("an unresolved alias in a real parsed directory yields a partial figure under 95%", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-partial-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }));
    await writeFile(path.join(root, "src", "entry.ts"), 'import "@/missing"; import "node:fs";');
    const result = await parseRepository(root);
    assert.equal(result.coverage.importsUnresolved, 1);
    assert.equal(result.coverage.importsOutside, 1);
    assert.equal(coverageSummary(result.coverage).percentage, 0);
    assert.equal(coverageSummary(result.coverage).partial, true);
    assert.equal(result.edges.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
