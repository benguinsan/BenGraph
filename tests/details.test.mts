import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, ParsedFile } from "../lib/parser/index.mts";
import { repositoryStructure } from "../lib/graph/details.mts";

const file = (path: string): ParsedFile => ({ path, folder: "", lines: 1, hash: "fixture", module: "esm", fanIn: 0, fanOut: 0 });
const edge = (from: string, to: string, kind: Edge["kind"] = "import"): Edge => ({ from, to, kind });

test("neighbours count files once across import kinds and preserve both directions", () => {
  const files = ["entry.ts", "shared.ts", "leaf.ts", "alone.ts"].map(file);
  const edges = [edge("entry.ts", "shared.ts"), edge("entry.ts", "shared.ts", "re-export"), edge("shared.ts", "leaf.ts"), edge("leaf.ts", "shared.ts")];
  const structure = repositoryStructure(files, edges);
  assert.deepEqual(structure.neighbours.get("shared.ts"), { dependencies: ["leaf.ts"], dependents: ["entry.ts", "leaf.ts"] });
  assert.deepEqual(structure.neighbours.get("alone.ts"), { dependencies: [], dependents: [] });
  assert.deepEqual(structure.mostImported.map(item => [item.path, item.count]), [["shared.ts", 2], ["leaf.ts", 1]]);
  assert.deepEqual(structure.entryPoints.map(item => [item.path, item.count]), [["entry.ts", 1], ["alone.ts", 0]]);
});

test("ranking is deterministic for ties and empty repositories", () => {
  const files = ["z.ts", "a.ts", "b.ts"].map(file);
  const edges = [edge("z.ts", "b.ts"), edge("z.ts", "a.ts")];
  const forward = repositoryStructure(files, edges);
  const reversed = repositoryStructure([...files].reverse(), [...edges].reverse());
  assert.deepEqual(forward.mostImported, reversed.mostImported);
  assert.deepEqual(forward.mostImported.map(item => item.path), ["a.ts", "b.ts"]);
  assert.deepEqual(repositoryStructure([], []).entryPoints, []);
});

test("missing endpoints fail rather than inventing files", () => {
  assert.throws(() => repositoryStructure([file("a.ts")], [edge("a.ts", "missing.ts")]), /missing/i);
});
