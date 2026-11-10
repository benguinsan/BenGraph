import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseRepository } from "../../lib/parser/index.mts";

// Parse source at test time so map checks never depend on a checked-in graph.
const root = await mkdtemp(path.join(tmpdir(), "cartograph-map-fixture-"));
const sources = {
  "core/a.ts": 'import "./b"; export const a = 1;',
  "core/b.ts": 'import "./a"; export const b = 2;',
  "ui/panel.tsx": 'import "../core/a"; export const panel = 1;',
  "ui/toolbar.tsx": 'import "../core/b"; export const toolbar = 1;',
  "utils/format.ts": 'export const format = (value: string) => value;',
  "utils/index.ts": 'export { format } from "./format";',
  "feature/entry.ts": 'import "./leaf"; import "../utils";',
  "feature/leaf.ts": 'export const leaf = 1;',
};

export const testAnalysis = await (async () => {
  try {
    await Promise.all(Object.entries(sources).map(async ([file, content]) => {
      const destination = path.join(root, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }));
    return await parseRepository(root);
  } finally { await rm(root, { recursive: true, force: true }); }
})();
