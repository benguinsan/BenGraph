import assert from "node:assert/strict";
import test from "node:test";
import { isStoredAnalysis } from "../lib/parser/index.mts";
import { testAnalysis } from "./fixtures/repository.mts";

test("stored results retain parser facts without requiring a temporary filesystem root", () => {
  const { files, edges, imports, coverage } = testAnalysis;
  assert.ok(isStoredAnalysis({ ...testAnalysis, files, edges, imports, coverage }));
  assert.equal(isStoredAnalysis({ ...testAnalysis, coverage: null }), false);
  assert.equal(isStoredAnalysis({ ...testAnalysis, files: files.map(file => ({ ...file, folder: null })) }), false);
  assert.equal(isStoredAnalysis({ ...testAnalysis, edges: [{ from: files[0].path, to: "missing.ts", kind: "import" }] }), false);
  assert.equal(isStoredAnalysis({ ...testAnalysis, coverage: { ...coverage, filesParsed: files.length + 1 } }), false);
});

test("stored framework roles and routes must name real files and contain valid unique facts", () => {
  const facts = { ...testAnalysis, framework: "react", roles: [{ path: "ui/panel.tsx", role: "component" }], routes: [] };
  assert.ok(isStoredAnalysis(facts));
  assert.equal(isStoredAnalysis({ ...facts, framework: "guessed" }), false);
  assert.equal(isStoredAnalysis({ ...facts, roles: [{ path: "absent.ts", role: "component" }] }), false);
  assert.equal(isStoredAnalysis({ ...facts, roles: [...facts.roles, ...facts.roles] }), false);
  assert.equal(isStoredAnalysis({ ...facts, framework: null }), false);
  assert.equal(isStoredAnalysis({ ...facts, routes: [{ file: "absent.ts", method: "GET", path: "/" }] }), false);
  assert.equal(isStoredAnalysis({ ...facts, routes: [{ file: "ui/panel.tsx", method: "guess", path: "/" }] }), false);
  assert.equal(isStoredAnalysis({ ...facts, routes: [{ file: "ui/panel.tsx", method: "GET", path: "relative" }] }), false);
});
