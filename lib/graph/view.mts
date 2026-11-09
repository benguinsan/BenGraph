import { Graph, layout, type GraphLabel, type NodeLabel, type EdgeLabel } from "@dagrejs/dagre";
import type { Edge, ParsedFile } from "../parser/index.mts";
import { compare, shortestLabels, type FoldedModule } from "./folding.mts";

export const ROW_HEIGHT = 24;
const VISIBLE_ROWS = 8;

export function rowViewport(count: number, scrollTop: number) {
  const height = Math.min(count, VISIBLE_ROWS) * ROW_HEIGHT;
  const offset = Math.max(0, Math.min(scrollTop, count * ROW_HEIGHT - height));
  return {
    height,
    first: Math.floor(offset / ROW_HEIGHT),
    last: Math.min(count, Math.ceil((offset + height) / ROW_HEIGHT)),
    positions: Array.from({ length: count }, (_, index) => Math.max(0, Math.min(height, (index + 0.5) * ROW_HEIGHT - offset))),
  };
}
export function localEdgePath(sourceX: number, sourceY: number, targetX: number, targetY: number) {
  return `M ${sourceX} ${sourceY} C ${sourceX + 32} ${sourceY - 12} ${targetX + 32} ${targetY + 12} ${targetX} ${targetY}`;
}
export type Selection = { kind: "folder" | "file"; id: string } | null;
export interface ViewNode extends FoldedModule {
  label: string;
  expanded: boolean;
  rows: { file: ParsedFile; label: string }[];
  headerHeight: number;
  width: number;
  height: number;
  position: { x: number; y: number };
}
export interface ViewEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  imports: Edge[];
}

export function viewBounds(nodes: readonly Pick<ViewNode, "position" | "width" | "height">[]) {
  if (nodes.length === 0) return null;
  const x = Math.min(...nodes.map(node => node.position.x));
  const y = Math.min(...nodes.map(node => node.position.y));
  return { x, y,
    width: Math.max(...nodes.map(node => node.position.x + node.width)) - x,
    height: Math.max(...nodes.map(node => node.position.y + node.height)) - y,
  };
}

export function buildView(modules: readonly FoldedModule[], imports: readonly Edge[], expanded: ReadonlySet<string>) {
  const ordered = [...modules].sort((a, b) => compare(a.folder, b.folder));
  const labels = shortestLabels(ordered.flatMap(m => [m.folder, ...(expanded.has(m.folder) ? m.files.map(f => f.path) : [])]));
  const nodes: ViewNode[] = ordered.map(module => {
    const open = expanded.has(module.folder);
    const label = labels.get(module.folder)!;
    const rows = open ? module.files.map(file => ({ file, label: labels.get(file.path)! })) : [];
    const headerHeight = 48 + Math.ceil(Math.log2(module.fanIn + 1) * 9);
    const width = Math.max(open ? 260 : 154, label.length * 7 + 48, ...rows.map(row => row.label.length * 7 + 104));
    return { ...module, label, expanded: open, rows, headerHeight, width,
      height: headerHeight + Math.min(rows.length, VISIBLE_ROWS) * ROW_HEIGHT + (rows.length > VISIBLE_ROWS ? ROW_HEIGHT : 0),
      position: { x: 0, y: 0 } };
  });
  const owner = new Map(nodes.flatMap(node => node.files.map(file => [file.path, node] as const)));
  const projected = new Map<string, ViewEdge>();
  function handle(node: ViewNode, path: string, direction: "in" | "out") {
    return `${direction}:${node.expanded ? path : "folder"}`;
  }
  for (const edge of [...imports].sort((a, b) => compare(`${a.from}\0${a.to}\0${a.kind}`, `${b.from}\0${b.to}\0${b.kind}`))) {
    const source = owner.get(edge.from);
    const target = owner.get(edge.to);
    if (!source || !target) throw new Error(`Import endpoint is missing: ${edge.from} → ${edge.to}`);
    if (source === target && !source.expanded) continue;
    const sourceHandle = handle(source, edge.from, "out");
    const targetHandle = `${source === target ? "local:" : ""}${handle(target, edge.to, "in")}`;
    const id = JSON.stringify([source.id, sourceHandle, target.id, targetHandle]);
    const existing = projected.get(id);
    if (existing) existing.imports.push(edge);
    else projected.set(id, { id, source: source.id, target: target.id, sourceHandle, targetHandle, imports: [edge] });
  }
  const edges = [...projected.values()];
  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>();
  graph.setGraph({ rankdir: "LR", nodesep: 22, ranksep: 54, marginx: 12, marginy: 12 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) graph.setNode(node.id, { width: node.width, height: node.height });
  for (const edge of edges) if (edge.source !== edge.target) graph.setEdge(edge.source, edge.target);
  if (nodes.length > 0) layout(graph);
  for (const node of nodes) {
    const placed = graph.node(node.id);
    if (placed.x === undefined || placed.y === undefined) throw new Error(`Layout is missing: ${node.folder}`);
    node.position = { x: placed.x - node.width / 2, y: placed.y - node.height / 2 };
  }
  // Dense cycles make long dagre ranks. Pack their dependency order so labels
  // remain readable when the whole repository is fitted into the canvas.
  const packingOrder = [...nodes].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y || compare(a.id, b.id));
  const columns = Math.ceil(Math.sqrt(nodes.length));
  const widths = Array.from({ length: columns }, (_, col) => Math.max(...packingOrder.filter((_, index) => index % columns === col).map(n => n.width)));
  let y = 0;
  for (let index = 0; index < packingOrder.length; index += columns) {
    const row = packingOrder.slice(index, index + columns);
    let x = 0;
    row.forEach((node, col) => {
      node.position = { x, y };
      x += widths[col] + 38;
    });
    y += Math.max(...row.map(node => node.height)) + 32;
  }
  return { nodes, edges };
}

export function focusGraph(modules: readonly FoldedModule[], edges: readonly Edge[], selection: Selection, matchingFiles: ReadonlySet<string> | null = null) {
  const selected = new Set(selection?.kind === "file" ? [selection.id] : modules.find(m => m.folder === selection?.id)?.files.map(f => f.path));
  const imports = selection ? edges.filter(edge => selected.has(edge.from) || selected.has(edge.to)) : [...edges];
  const files = new Set(matchingFiles ?? (selection ? [...selected, ...imports.flatMap(edge => [edge.from, edge.to])] : modules.flatMap(m => m.files.map(f => f.path))));
  const folders = new Set(modules.filter(module => module.files.some(file => files.has(file.path))).map(module => module.folder));
  const matchCounts = matchingFiles === null ? null : new Map(modules.map(module => [module.folder, module.files.filter(file => matchingFiles.has(file.path)).length]));
  return { selected, files, folders, imports, matchCounts };
}
