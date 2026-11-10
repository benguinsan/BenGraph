"use client";

import { useCallback, useMemo, useState } from "react";
import type { StoredAnalysis } from "@/lib/parser/index.mts";
import { foldFiles } from "@/lib/graph/folding.mts";
import { repositoryStructure } from "@/lib/graph/details.mts";
import { fileCategories, repositoryInsights } from "@/lib/graph/analysis.mts";
import type { Selection } from "@/lib/graph/view.mts";
import { DependencyMap } from "./dependency-map";
import { DetailPane } from "./detail-pane";

/** Shares local selection, hover and expansion between the stored map and detail pane. */
export function RepositoryMap({ analysis, name }: { analysis: StoredAnalysis; name: string }) {
  const [selection, setSelection] = useState<Selection>(null);
  const [hovered, setHovered] = useState<Selection>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [category, setCategory] = useState<string | null>(null);
  const folded = useMemo(() => foldFiles(analysis.files, analysis.edges), [analysis]);
  const structure = useMemo(() => repositoryStructure(analysis.files, analysis.edges), [analysis]);
  const categories = useMemo(() => fileCategories(analysis.files), [analysis]);
  const insights = useMemo(() => repositoryInsights(analysis.files, analysis.edges), [analysis]);
  const matchingFiles = category === null ? null : categories.get(category)!;

  /** Reveals and selects a file in its owning folded folder, rejecting paths absent from the graph. */
  const selectFile = useCallback((path: string) => {
    const owner = folded.modules.find(module => module.files.some(file => file.path === path));
    if (!owner) throw new Error(`Selected file is missing: ${path}`);
    setExpanded(current => current.has(owner.folder) ? current : new Set([...current, owner.folder]));
    setSelection({ kind: "file", id: path });
    setHovered(null);
  }, [folded]);

  /** Opens or closes a folded folder and makes it the current detail selection. */
  const toggle = useCallback((folder: string) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
    setSelection({ kind: "folder", id: folder });
  }, []);

  return (
    <>
      <aside aria-label="File categories" className="overflow-y-auto border-r border-line bg-raised">
        <h2 className="flex h-9 items-center border-b border-line px-3 font-medium">File categories</h2>
        <ul className="py-1">
          {[...categories].map(([extension, files]) => (
            <li key={extension}>
              <button type="button" aria-pressed={category === extension}
                className={`flex h-7 w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent ${category === extension ? "bg-accent/10 text-accent" : ""}`}
                onClick={() => setCategory(current => current === extension ? null : extension)}>
                <span className="file-kind" data-extension={extension} aria-hidden />
                <span className="font-mono">{extension}</span>
                <span className="ml-auto tabular-nums text-muted">{files.size}</span>
              </button>
            </li>
          ))}
        </ul>
        {category !== null && <p className="border-t border-line px-3 py-2 text-[11px] text-muted">Panel counts show matched / total files. Click the category again to clear.</p>}
      </aside>
      <section aria-label="Dependency map" className="flex min-h-0 min-w-0 flex-col">
        <div className="min-h-0 flex-1">
          <DependencyMap analysis={analysis} name={name} modules={folded.modules} expanded={expanded}
            matchingFiles={matchingFiles}
            selection={selection} hovered={hovered} onHover={setHovered}
            onSelectFile={selectFile} onToggle={toggle} onDeselect={() => setSelection(null)} />
        </div>
      </section>
      <DetailPane analysis={analysis} name={name} modules={folded.modules} structure={structure}
        insights={insights}
        selection={selection} hovered={hovered} onHover={setHovered} onSelectFile={selectFile} />
    </>
  );
}
