import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, ParsedFile } from "../lib/parser/index.mts";
import { repositoryStructure } from "../lib/graph/details.mts";
import { fileCategories, importCycles, repositoryInsights, walkGraph } from "../lib/graph/analysis.mts";
import { previewAnalysis } from "../data/preview-analysis.mts";

const file = (path: string, lines = 1): ParsedFile => ({ path, folder: path.slice(0, Math.max(0, path.lastIndexOf("/"))), lines, hash: "fixture", module: "esm", fanIn: 0, fanOut: 0 });
const edge = (from: string, to: string, kind: Edge["kind"] = "import"): Edge => ({ from, to, kind });

test("walk follows either direction up to two hops, without duplicates or the starting file", () => {
  const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "alone.ts"].map(path => file(path));
  const edges = [edge("a.ts", "b.ts"), edge("a.ts", "b.ts", "re-export"), edge("a.ts", "c.ts"), edge("b.ts", "c.ts"), edge("c.ts", "d.ts"), edge("d.ts", "e.ts"), edge("d.ts", "a.ts")];
  const { neighbours } = repositoryStructure(files, edges);
  assert.deepEqual(walkGraph(neighbours, "a.ts", "dependencies"), [
    { path: "b.ts", depth: 1 }, { path: "c.ts", depth: 1 }, { path: "d.ts", depth: 2 },
  ]);
  assert.deepEqual(walkGraph(neighbours, "c.ts", "dependents"), [
    { path: "a.ts", depth: 1 }, { path: "b.ts", depth: 1 }, { path: "d.ts", depth: 2 },
  ]);
  assert.deepEqual(walkGraph(neighbours, "a.ts", "dependencies", 1), [{ path: "b.ts", depth: 1 }, { path: "c.ts", depth: 1 }]);
  assert.deepEqual(walkGraph(neighbours, "a.ts", "dependencies", 3).at(-1), { path: "e.ts", depth: 3 });
  assert.deepEqual(walkGraph(neighbours, "a.ts", "dependencies", 0), []);
  assert.deepEqual(walkGraph(neighbours, "alone.ts", "dependents"), []);
  assert.throws(() => walkGraph(neighbours, "missing.ts", "dependencies"), /missing/i);
  for (const depth of [-1, 1.5, Infinity, NaN]) assert.throws(() => walkGraph(neighbours, "a.ts", "dependencies", depth), /depth/i);
});

test("cycles are closed paths of actual imports, including self-imports, without treating shared dependencies as cycles", () => {
  const files = ["a.ts", "b.ts", "c.ts", "d.ts", "self.ts"].map(path => file(path));
  const edges = [edge("a.ts", "b.ts"), edge("b.ts", "c.ts"), edge("c.ts", "a.ts"), edge("a.ts", "d.ts"), edge("b.ts", "d.ts"), edge("self.ts", "self.ts")];
  const cycles = importCycles(repositoryStructure(files, edges).neighbours);
  assert.deepEqual(cycles, [["a.ts", "b.ts", "c.ts", "a.ts"], ["self.ts", "self.ts"]]);
  assert.deepEqual(importCycles(repositoryStructure([...files].reverse(), [...edges].reverse()).neighbours), cycles);
  assert.deepEqual(importCycles(repositoryStructure(files, edges.filter(item => item.from !== "c.ts" && item.from !== "self.ts")).neighbours), []);
});

test("cycle detection handles a graph deeper than the JavaScript call stack", () => {
  const files = Array.from({ length: 20000 }, (_, index) => file(`${String(index).padStart(5, "0")}.ts`));
  const edges = files.slice(1).map((item, index) => edge(files[index].path, item.path));
  edges.push(edge(files.at(-1)!.path, files[0].path));
  const cycles = importCycles(repositoryStructure(files, edges).neighbours);
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].length, 20001);
  assert.equal(cycles[0][0], cycles[0].at(-1));
});

test("insights exclude convention entry files and use distinct importers and line boundaries", () => {
  const entries = ["app/page.tsx", "src/app/api/items/route.ts", "app/(app)/layout.tsx", "pages/index.tsx", "src/pages/api/items.ts", "middleware.ts", "src/middleware.ts", "next.config.ts", "eslint.config.mjs", "app/sitemap.ts", "app/robots.ts", "app/manifest.ts", "app/icon.tsx", "app/opengraph-image.tsx", "app/global-not-found.tsx"];
  const files = [...entries.map(path => file(path)), file("components/page.tsx"), file("lib/alone.ts"), file("shared.ts", 501), file("boundary.ts", 500), ...Array.from({ length: 10 }, (_, i) => file(`users/${i}.ts`))];
  const edges = [...Array.from({ length: 10 }, (_, i) => edge(`users/${i}.ts`, "shared.ts")), edge("users/0.ts", "shared.ts", "re-export"), ...Array.from({ length: 9 }, (_, i) => edge(`users/${i}.ts`, "boundary.ts"))];
  const insights = repositoryInsights(files, edges);
  assert.ok(entries.every(path => !insights.unimported.some(item => item.path === path)));
  assert.ok(insights.unimported.some(item => item.path === "components/page.tsx"));
  assert.ok(insights.unimported.some(item => item.path === "lib/alone.ts"));
  assert.deepEqual(insights.highFanIn, [{ path: "shared.ts", count: 10 }]);
  assert.deepEqual(insights.longFiles, [{ path: "shared.ts", count: 501 }]);
  assert.deepEqual(repositoryInsights([], []), { unimported: [], highFanIn: [], cycles: [], longFiles: [] });
});

test("categories count only real files and keep a deterministic order", () => {
  const files = ["a/one.ts", "a/two.tsx", "b/three.ts", "b/four.mjs"].map(path => file(path));
  const categories = fileCategories(files);
  assert.deepEqual([...categories].map(([extension, paths]) => [extension, [...paths]]), [
    [".mjs", ["b/four.mjs"]], [".ts", ["a/one.ts", "b/three.ts"]], [".tsx", ["a/two.tsx"]],
  ]);
  assert.deepEqual(fileCategories([...files].reverse()), categories);
  assert.deepEqual(fileCategories([]), new Map());
});

test("checked-in parser data yields real closed import paths without synthetic edges", () => {
  const { files, edges } = previewAnalysis;
  const insights = repositoryInsights(files, edges);
  assert.ok(fileCategories(files).has(".ts"));
  assert.ok(fileCategories(files).has(".tsx"));
  assert.ok(insights.unimported.length > 0);
  assert.ok(insights.cycles.length > 0);
  for (const cycle of insights.cycles) {
    assert.equal(cycle[0], cycle.at(-1));
    for (let i = 1; i < cycle.length; i++) assert.ok(edges.some(item => item.from === cycle[i - 1] && item.to === cycle[i]));
  }
  console.log(`Preview insights: ${insights.unimported.length} unimported files; ${insights.highFanIn.length} files with ≥10 importers; ${insights.cycles.length} import cycles; ${insights.longFiles.length} files over 500 lines.`);
});
