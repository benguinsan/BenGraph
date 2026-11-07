import type { Edge, ParsedFile } from "../parser/index.mts";

export interface FoldedModule {
  id: string;
  folder: string;
  files: ParsedFile[];
  fanIn: number;
  fanOut: number;
}

export const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const parent = (folder: string) => folder.slice(0, Math.max(0, folder.lastIndexOf("/")));
const depth = (folder: string) => folder ? folder.split("/").length : 0;

export function foldFiles(files: readonly ParsedFile[], edges: readonly Edge[]) {
  const original = new Map<string, ParsedFile[]>([["", []]]);
  for (const file of [...files].sort((a, b) => compare(a.path, b.path))) {
    let folder = file.folder;
    if (!original.has(folder)) original.set(folder, []);
    original.get(folder)!.push(file);
    while (folder) {
      folder = parent(folder);
      if (!original.has(folder)) original.set(folder, []);
    }
  }
  const maxDepth = Math.max(0, ...[...original.keys()].map(depth));
  let threshold = 2;
  let groups: Map<string, ParsedFile[]>;
  for (;;) {
    groups = new Map([...original].map(([folder, members]) => [folder, [...members]]));
    for (let level = maxDepth; level > 0; level--) {
      // Decide the entire depth before applying any of its merges.
      const merges = [...groups].filter(([folder, members]) => depth(folder) === level && members.length < threshold);
      for (const [folder, members] of merges) {
        groups.get(parent(folder))!.push(...members);
        groups.delete(folder);
      }
    }
    for (const [folder, members] of groups) if (members.length === 0) groups.delete(folder);
    // A lone root file needs a higher fresh pass too; it cannot merge upward.
    if (groups.size <= 24 && (files.length < 2 || [...groups.values()].every(members => members.length > 1))) break;
    threshold++;
  }
  const owner = new Map([...groups].flatMap(([folder, members]) => members.map(file => [file.path, folder] as const)));
  const incoming = new Map([...groups.keys()].map(folder => [folder, new Set<string>()]));
  const outgoing = new Map([...groups.keys()].map(folder => [folder, new Set<string>()]));
  for (const edge of edges) {
    const from = owner.get(edge.from);
    const to = owner.get(edge.to);
    if (from === undefined || to === undefined) throw new Error(`Import endpoint is missing: ${edge.from} → ${edge.to}`);
    if (from === to) continue;
    incoming.get(to)!.add(edge.from);
    outgoing.get(from)!.add(edge.to);
  }
  const modules: FoldedModule[] = [...groups].sort(([a], [b]) => compare(a, b)).map(([folder, members]) => ({
    id: `folder:${folder || "."}`, folder,
    files: members.sort((a, b) => compare(a.path, b.path)),
    fanIn: incoming.get(folder)!.size,
    fanOut: outgoing.get(folder)!.size,
  }));
  return { threshold, modules };
}

export function shortestLabels(paths: readonly string[]): Map<string, string> {
  return new Map(paths.map(path => {
    const parts = path.split("/");
    for (let count = 1; count <= parts.length; count++) {
      const suffix = parts.slice(-count).join("/");
      if (paths.every(other => other === path || (other !== suffix && !other.endsWith(`/${suffix}`)))) return [path, suffix || "."];
    }
    return [path, path || "."];
  }));
}
