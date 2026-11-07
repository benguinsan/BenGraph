import { ThemeControl } from "@/components/theme-control";
import { RepositoryMap } from "@/components/repository-map";
import { previewAnalysis } from "@/data/preview-analysis.mts";

const mockCategories = [
  { extension: ".tsx", count: 48 },
  { extension: ".mjs", count: 12 },
  { extension: ".cjs", count: 8 },
  { extension: ".js", count: 64 },
];

export default function PreviewPage() {
  const counts = new Map<string, number>();
  for (const file of previewAnalysis.files) {
    const extension = file.path.slice(file.path.lastIndexOf("."));
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return (
    <div className="flex h-dvh flex-col overflow-x-auto">
      <header className="flex h-9 min-w-192 shrink-0 items-center gap-3 border-b border-line px-3">
        <span className="font-semibold tracking-tight">Cartograph</span>
        <span className="text-muted">Preview</span>
        <div className="ml-auto">
          <ThemeControl />
        </div>
      </header>
      <main className="grid min-h-0 min-w-192 flex-1 grid-cols-[11rem_minmax(19rem,1fr)_clamp(18rem,32vw,28rem)]">
        <aside aria-label="File categories" className="overflow-y-auto border-r border-line bg-raised">
          <h2 className="flex h-9 items-center border-b border-line px-3 font-medium">File categories</h2>
          <ul className="py-1">
            {[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([extension, count]) => (
              <li key={extension} className="flex h-7 items-center gap-2 px-3">
                <span className="file-kind" data-extension={extension} aria-hidden />
                <span className="font-mono">{extension}</span>
                <span className="ml-auto tabular-nums text-muted">{count}</span>
              </li>
            ))}
          </ul>
          <h3 className="border-t border-line px-3 pt-2 text-[11px] text-muted">Mock categories</h3>
          <ul aria-label="Mock file categories" className="py-1">
            {mockCategories.map(({ extension, count }) => (
              <li key={extension} className="flex h-7 items-center gap-2 px-3">
                <span className="file-kind" data-extension={extension} aria-hidden />
                <span className="font-mono">{extension}</span>
                <span className="ml-auto tabular-nums text-muted">{count}</span>
              </li>
            ))}
          </ul>
        </aside>
        <RepositoryMap analysis={previewAnalysis} name="ts-morph / compiler" examples={[
          "ast/type/TypeNode.ts",
          "ast/statement/Statement.ts",
          "ast/expression/Expression.ts",
        ]} />
      </main>
    </div>
  );
}
