import type { Edge, ParsedFile } from "../parser/index.mts";
import { isConventionEntryPoint } from "../adapters/entry-points.mts";
import { repositoryStructure } from "./details.mts";
import { compare } from "./folding.mts";

type Neighbours = ReturnType<typeof repositoryStructure>["neighbours"];
export type WalkDirection = "dependencies" | "dependents";
export const HIGH_FAN_IN = 10;
export const LONG_FILE_LINES = 500;

/** Breadth-first traversal records the shortest distance and never returns the starting file. */
export function walkGraph(neighbours: Neighbours, start: string, direction: WalkDirection, maxDepth = 2) {
  if (!neighbours.has(start)) throw new Error(`Starting file is missing: ${start}`);
  if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new Error("Depth must be a non-negative integer");
  const seen = new Set([start]);
  const queue = [{ path: start, depth: 0 }];
  const result: { path: string; depth: number }[] = [];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.depth >= maxDepth) continue;
    for (const path of neighbours.get(current.path)![direction]) {
      if (seen.has(path)) continue;
      seen.add(path);
      const item = { path, depth: current.depth + 1 };
      result.push(item);
      queue.push(item);
    }
  }
  return result.sort((a, b) => a.depth - b.depth || compare(a.path, b.path));
}

/** Iterative DFS reports closed import paths at back edges, rather than inventing an order for cycle members. */
export function importCycles(neighbours: Neighbours): string[][] {
  // shortcut: DFS reports example paths, use strongly connected groups when every cyclic file must be listed.
  const visited = new Set<string>();
  const active = new Map<string, number>();
  const cycles: string[][] = [];
  for (const start of [...neighbours.keys()].sort(compare)) {
    if (visited.has(start)) continue;
    const stack = [{ path: start, next: 0 }];
    visited.add(start);
    active.set(start, 0);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const dependencies = neighbours.get(frame.path)!.dependencies;
      if (frame.next === dependencies.length) {
        active.delete(frame.path);
        stack.pop();
        continue;
      }
      const target = dependencies[frame.next++];
      const position = active.get(target);
      if (position !== undefined) cycles.push([...stack.slice(position).map(item => item.path), target]);
      else if (!visited.has(target)) {
        visited.add(target);
        active.set(target, stack.length);
        stack.push({ path: target, next: 0 });
      }
    }
  }
  return cycles;
}

/** Derives factual insight groups from resolved imports and file metadata, excluding conventional entry files from unimported results. */
export function repositoryInsights(files: readonly ParsedFile[], edges: readonly Edge[]) {
  const structure = repositoryStructure(files, edges);
  return {
    unimported: structure.entryPoints.filter(file => !isConventionEntryPoint(file.path)),
    highFanIn: structure.mostImported.filter(file => file.count >= HIGH_FAN_IN),
    cycles: importCycles(structure.neighbours),
    longFiles: files.filter(file => file.lines > LONG_FILE_LINES).map(file => ({ path: file.path, count: file.lines }))
      .sort((a, b) => b.count - a.count || compare(a.path, b.path)),
  };
}

/** Groups actual file paths by extension in deterministic order; absent extensions never acquire fabricated counts. */
export function fileCategories(files: readonly ParsedFile[]) {
  const categories = new Map<string, Set<string>>();
  for (const file of [...files].sort((a, b) => compare(a.path, b.path))) {
    const extension = file.path.slice(file.path.lastIndexOf("."));
    if (!categories.has(extension)) categories.set(extension, new Set());
    categories.get(extension)!.add(file.path);
  }
  return new Map([...categories].sort(([a], [b]) => compare(a, b)));
}
