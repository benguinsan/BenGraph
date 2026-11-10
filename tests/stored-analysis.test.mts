import assert from "node:assert/strict";
import test from "node:test";
import { isStoredAnalysis } from "../lib/parser/index.mts";
import { testAnalysis } from "./fixtures/repository.mts";

test("stored results retain parser facts without requiring a temporary filesystem root", () => {
  const { files, edges, imports, coverage } = testAnalysis;
  assert.ok(isStoredAnalysis({ files, edges, imports, coverage }));
  assert.equal(isStoredAnalysis({ files, edges, imports, coverage: null }), false);
  assert.equal(isStoredAnalysis({ files: files.map(file => ({ ...file, folder: null })), edges, imports, coverage }), false);
  assert.equal(isStoredAnalysis({ files, edges: [{ from: files[0].path, to: "missing.ts", kind: "import" }], imports, coverage }), false);
  assert.equal(isStoredAnalysis({ files, edges, imports, coverage: { ...coverage, filesParsed: files.length + 1 } }), false);
});
