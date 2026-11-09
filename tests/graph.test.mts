import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, ParsedFile } from "../lib/parser/index.mts";
import { foldFiles, shortestLabels } from "../lib/graph/folding.mts";
import { buildView, focusGraph, localEdgePath, rowViewport, viewBounds } from "../lib/graph/view.mts";
import { previewAnalysis } from "../data/preview-analysis.mts";

function file(path: string): ParsedFile {
  return { path, folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", lines: 1, hash: "fixture", module: "esm", fanIn: 0, fanOut: 0 };
}
const edge = (from: string, to: string): Edge => ({ from, to, kind: "import" });

test("viewport bounds include every node, independent of which node was measured first", () => {
  const nodes = [
    { position: { x: 0, y: 0 }, width: 100, height: 50 },
    { position: { x: 160, y: 80 }, width: 30, height: 40 },
    { position: { x: -20, y: -10 }, width: 50, height: 20 },
  ];
  assert.deepEqual(viewBounds(nodes), { x: -20, y: -10, width: 210, height: 130 });
  assert.deepEqual(viewBounds([...nodes].reverse()), { x: -20, y: -10, width: 210, height: 130 });
  assert.equal(viewBounds([]), null);
});

test("small descendants merge deepest-first without swallowing a larger sibling", () => {
  const files = ["src/a/one.ts", "src/b/two.ts", "src/keep/x.ts", "src/keep/y.ts"].map(file);
  const folded = foldFiles(files, []);
  assert.equal(folded.threshold, 2);
  assert.deepEqual(folded.modules.map(m => [m.folder, m.files.map(f => f.path)]), [
    ["src", ["src/a/one.ts", "src/b/two.ts"]],
    ["src/keep", ["src/keep/x.ts", "src/keep/y.ts"]],
  ]);
  assert.deepEqual(foldFiles([...files].reverse(), []), folded);
});

test("raises the threshold from a fresh tree until fewer than 25 modules remain", () => {
  const files = Array.from({ length: 25 }, (_, i) => [`dir${i}/a.ts`, `dir${i}/b.ts`]).flat().map(file);
  const folded = foldFiles(files, []);
  assert.equal(folded.threshold, 3);
  assert.equal(folded.modules.length, 1);
  assert.equal(folded.modules[0].files.length, 50);
});

test("does not strand a lone root file as its own node", () => {
  const folded = foldFiles(["root.ts", "a/x.ts", "a/y.ts", "b/x.ts", "b/y.ts"].map(file), []);
  assert.ok(folded.modules.every(m => m.files.length > 1));
  assert.equal(folded.modules.flatMap(m => m.files).length, 5);
});

test("fan-in counts distinct external files, not duplicate imports or internal edges", () => {
  const files = ["a/x.ts", "a/y.ts", "b/x.ts", "b/y.ts", "c/x.ts", "c/y.ts"].map(file);
  const edges = [edge("b/x.ts", "a/x.ts"), edge("b/x.ts", "a/y.ts"), edge("c/x.ts", "a/x.ts"), edge("a/x.ts", "a/y.ts")];
  const folded = foldFiles(files, edges);
  assert.equal(folded.modules.find(m => m.folder === "a")?.fanIn, 2);
  const view = buildView(folded.modules, edges, new Set());
  assert.ok(view.nodes.find(n => n.folder === "a")!.height > view.nodes.find(n => n.folder === "b")!.height);
  assert.equal(view.nodes.find(n => n.folder === "a")!.width, view.nodes.find(n => n.folder === "b")!.width);
});

test("labels use the shortest unique suffix, including names that are suffixes of others", () => {
  assert.deepEqual([...shortestLabels(["a/src/index.ts", "b/src/index.ts", "utils.ts"])], [
    ["a/src/index.ts", "a/src/index.ts"], ["b/src/index.ts", "b/src/index.ts"], ["utils.ts", "utils.ts"],
  ]);
  assert.equal(shortestLabels(["src", "a/src"]).get("a/src"), "a/src");
});

test("opening exposes every file to scrolling without growing the panel beyond eight rows", () => {
  const files = ["b/one.ts", "b/two.ts", ...Array.from({ length: 12 }, (_, i) => `a/file${String(i).padStart(2, "0")}.ts`)].map(file);
  const edges = [edge("b/one.ts", "a/file00.ts"), edge("b/two.ts", "a/file11.ts"), edge("a/file00.ts", "a/file01.ts")];
  const { modules } = foldFiles(files, edges);
  const closed = buildView(modules, edges, new Set());
  const opened = buildView(modules, edges, new Set(["a"]));
  const panel = opened.nodes.find(n => n.folder === "a")!;
  assert.equal(panel.rows.length, 12);
  assert.equal(panel.height - panel.headerHeight, 216);
  assert.equal(opened.edges.find(e => e.imports.some(i => i.to === "a/file00.ts"))?.targetHandle, "in:a/file00.ts");
  assert.equal(opened.edges.find(e => e.imports.some(i => i.to === "a/file11.ts"))?.targetHandle, "in:a/file11.ts");
  assert.ok(opened.edges.some(e => e.source === e.target));
  assert.equal(opened.edges.flatMap(e => e.imports).length, 3);
  assert.deepEqual(buildView(modules, edges, new Set()), closed);
  assert.deepEqual(buildView([...modules].reverse(), [...edges].reverse(), new Set(["a"])), opened);
  assert.ok(opened.edges.every(e => opened.nodes.some(n => n.id === e.source) && opened.nodes.some(n => n.id === e.target)));
  for (const node of opened.nodes) assert.ok(Number.isFinite(node.position.x) && Number.isFinite(node.position.y));
});

test("scrolling moves row endpoints and clamps off-screen connections to list boundaries", () => {
  const top = rowViewport(12, 0);
  assert.equal(top.height, 192);
  assert.equal(top.first, 0);
  assert.equal(top.last, 8);
  assert.equal(top.positions[0], 12);
  assert.equal(top.positions[7], 180);
  assert.equal(top.positions[11], 192);

  const middle = rowViewport(12, 48);
  assert.equal(middle.first, 2);
  assert.equal(middle.last, 10);
  assert.equal(middle.positions[0], 0);
  assert.equal(middle.positions[2], 12);
  assert.equal(middle.positions[9], 180);
  assert.equal(middle.positions[11], 192);

  const end = rowViewport(12, 999);
  assert.equal(end.first, 4);
  assert.equal(end.last, 12);
  assert.equal(end.positions[11], 180);
  assert.deepEqual(rowViewport(12, -10), top);
  assert.equal(rowViewport(6, 100).height, 144);
  assert.equal(rowViewport(6, 100).first, 0);
  assert.equal(rowViewport(0, 0).positions.length, 0);
});

test("selecting a file preserves only its actual neighbors and incident edges", () => {
  const files = ["a/x.ts", "a/y.ts", "b/x.ts", "b/y.ts", "c/x.ts", "c/y.ts"].map(file);
  const edges = [edge("a/x.ts", "b/x.ts"), edge("b/x.ts", "c/x.ts")];
  const { modules } = foldFiles(files, edges);
  const focus = focusGraph(modules, edges, { kind: "file", id: "a/x.ts" });
  assert.deepEqual([...focus.files].sort(), ["a/x.ts", "b/x.ts"]);
  assert.equal(focus.imports.length, 1);
  assert.equal(focus.folders.has("c"), false);
});

test("file selection keeps incoming and outgoing endpoints, without following their other imports", () => {
  const files = ["a/selected.ts", "a/other.ts", "b/incoming.ts", "b/other.ts", "c/outgoing.ts", "c/other.ts", "d/second-hop.ts", "d/other.ts"].map(file);
  const incoming = edge("b/incoming.ts", "a/selected.ts");
  const outgoing = edge("a/selected.ts", "c/outgoing.ts");
  const edges = [incoming, outgoing, edge("b/incoming.ts", "c/outgoing.ts"), edge("c/outgoing.ts", "d/second-hop.ts")];
  const { modules } = foldFiles(files, edges);
  const focus = focusGraph(modules, edges, { kind: "file", id: "a/selected.ts" });
  assert.deepEqual(focus.imports, [incoming, outgoing]);
  assert.deepEqual([...focus.files].sort(), ["a/selected.ts", "b/incoming.ts", "c/outgoing.ts"]);
  assert.deepEqual([...focus.folders].sort(), ["a", "b", "c"]);
});

test("folder selection includes every member and clearing selection restores every file", () => {
  const files = ["a/x.ts", "a/y.ts", "b/x.ts", "b/y.ts", "c/x.ts", "c/y.ts"].map(file);
  const internal = edge("a/x.ts", "a/y.ts");
  const incoming = edge("b/x.ts", "a/x.ts");
  const outgoing = edge("a/y.ts", "b/y.ts");
  const edges = [internal, incoming, outgoing, edge("b/y.ts", "c/x.ts")];
  const { modules } = foldFiles(files, edges);
  const focus = focusGraph(modules, edges, { kind: "folder", id: "a" });
  assert.deepEqual([...focus.selected].sort(), ["a/x.ts", "a/y.ts"]);
  assert.deepEqual([...focus.files].sort(), ["a/x.ts", "a/y.ts", "b/x.ts", "b/y.ts"]);
  assert.deepEqual(focus.imports, [internal, incoming, outgoing]);
  const cleared = focusGraph(modules, edges, null);
  assert.deepEqual([...cleared.files].sort(), files.map(file => file.path).sort());
  assert.deepEqual(cleared.imports, edges);
});

test("category focus takes precedence over selection, counts every panel, and keeps the full layout", () => {
  const files = ["a/one.ts", "a/two.tsx", "b/three.ts", "b/four.tsx", "c/five.tsx", "c/six.tsx"].map(file);
  const edges = [edge("a/one.ts", "a/two.tsx"), edge("b/three.ts", "b/four.tsx")];
  const { modules } = foldFiles(files, edges);
  const category = new Set(["a/one.ts", "b/three.ts"]);
  const focused = focusGraph(modules, edges, { kind: "file", id: "a/two.tsx" }, category);
  assert.deepEqual([...focused.files].sort(), ["a/one.ts", "b/three.ts"]);
  assert.deepEqual([...focused.folders].sort(), ["a", "b"]);
  assert.deepEqual([...focused.matchCounts!], [["a", 1], ["b", 1], ["c", 0]]);
  assert.equal([...focused.matchCounts!.values()].reduce((sum, count) => sum + count, 0), category.size);
  assert.deepEqual(focusGraph(modules, edges, null, new Set()).files, new Set());
  assert.equal(focusGraph(modules, edges, null).matchCounts, null);
  const view = buildView(modules, edges, new Set(["a", "b", "c"]));
  assert.equal(view.nodes.length, 3);
  assert.equal(view.nodes.flatMap(node => node.rows).length, 6);
  assert.equal(view.edges.flatMap(item => item.imports).length, 2);
});

test("internal imports remain visible when off-screen endpoints share a list boundary", () => {
  for (const targetY of [100, 148]) {
    const path = localEdgePath(100, 100, 100, targetY);
    const values = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    assert.equal(values.length, 8);
    assert.deepEqual(values.slice(0, 2), [100, 100]);
    assert.deepEqual(values.slice(-2), [100, targetY]);
    assert.ok(values[2] > 100 && values[4] > 100, "control points must extend outside the panel");
    if (targetY === 100) assert.ok(values[3] < 100 && values[5] > 100, "identical endpoints must form a visible loop");
  }
});

test("real preview has no singleton folders, lost files, dangling edges or overlapping panels", () => {
  const { files, edges } = previewAnalysis;
  const folded = foldFiles(files, edges);
  assert.ok(folded.modules.length <= 24);
  assert.ok(folded.modules.every(module => module.files.length > 1));
  assert.deepEqual(folded.modules.flatMap(module => module.files.map(file => file.path)).sort(), files.map(file => file.path).sort());
  const closed = buildView(folded.modules, edges, new Set());
  const opened = buildView(folded.modules, edges, new Set(folded.modules.map(module => module.folder)));
  // With every folder open, every parser edge must still be represented.
  assert.equal(opened.edges.flatMap(edge => edge.imports).length, edges.length);
  for (const view of [closed, opened]) {
    const byId = new Map(view.nodes.map(node => [node.id, node]));
    function hasHandle(node: (typeof view.nodes)[number], handle: string) {
      const name = handle.replace(/^local:/, "").replace(/^(in|out):/, "");
      return node.expanded ? node.rows.some(row => row.file.path === name) : name === "folder";
    }
    for (const edge of view.edges) {
      assert.ok(byId.has(edge.source) && byId.has(edge.target));
      assert.ok(hasHandle(byId.get(edge.source)!, edge.sourceHandle));
      assert.ok(hasHandle(byId.get(edge.target)!, edge.targetHandle));
    }
    for (let i = 0; i < view.nodes.length; i++) {
      const a = view.nodes[i];
      for (const b of view.nodes.slice(i + 1)) {
        assert.ok(a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x ||
          a.position.y + a.height <= b.position.y || b.position.y + b.height <= a.position.y);
      }
    }
  }
  console.log(`Preview: ${files.length} files; ${closed.nodes.length} nodes; ${closed.edges.length} folded edges; minimum ${Math.min(...folded.modules.map(m => m.files.length))} files/node; 0 dangling edges.`);
});
