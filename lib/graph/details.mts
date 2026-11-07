import type { Edge, ParsedFile } from "../parser/index.mts";
import { compare } from "./folding.mts";

export function repositoryStructure(files: readonly ParsedFile[], edges: readonly Edge[]) {
  const connections = new Map(files.map(file => [file.path, { dependencies: new Set<string>(), dependents: new Set<string>() }]));
  for (const edge of edges) {
    const from = connections.get(edge.from);
    const to = connections.get(edge.to);
    if (!from || !to) throw new Error(`Import endpoint is missing: ${edge.from} → ${edge.to}`);
    from.dependencies.add(edge.to);
    to.dependents.add(edge.from);
  }
  const neighbours = new Map([...connections].map(([path, value]) => [path, {
    dependencies: [...value.dependencies].sort(compare),
    dependents: [...value.dependents].sort(compare),
  }]));
  const rank = (a: { path: string; count: number }, b: { path: string; count: number }) => b.count - a.count || compare(a.path, b.path);
  return {
    neighbours,
    mostImported: [...neighbours].filter(([, value]) => value.dependents.length > 0)
      .map(([path, value]) => ({ path, count: value.dependents.length })).sort(rank),
    entryPoints: [...neighbours].filter(([, value]) => value.dependents.length === 0)
      .map(([path, value]) => ({ path, count: value.dependencies.length })).sort(rank),
  };
}
