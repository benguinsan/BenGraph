"use client";

import { useCallback, useId, useMemo, useState } from "react";
import type { StoredAnalysis } from "@/lib/parser/index.mts";
import { foldFiles } from "@/lib/graph/folding.mts";
import { repositoryStructure } from "@/lib/graph/details.mts";
import { repositoryInsights } from "@/lib/graph/analysis.mts";
import { repositoryCategories } from "@/lib/adapters/taxonomy.mts";
import type { Selection } from "@/lib/graph/view.mts";
import { DependencyMap } from "./dependency-map";
import { DetailPane } from "./detail-pane";
import { RoutesTable } from "./routes-table";

/** Shares local selection, hover and expansion between the stored map and detail pane. */
export function RepositoryMap({ analysis, name }: { analysis: StoredAnalysis; name: string }) {
  const [selection, setSelection] = useState<Selection>(null);
  const [hovered, setHovered] = useState<Selection>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [category, setCategory] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "routes">("map");
  const id = useId();
  const folded = useMemo(() => foldFiles(analysis.files, analysis.edges), [analysis]);
  const structure = useMemo(() => repositoryStructure(analysis.files, analysis.edges), [analysis]);
  const categories = useMemo(() => repositoryCategories(analysis.files, analysis.framework, analysis.roles), [analysis]);
  const insights = useMemo(() => repositoryInsights(analysis.files, analysis.edges), [analysis]);
  const matchingFiles = category === null ? null : categories.get(category) ?? null;

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
          {[...categories].map(([label, files]) => (
            <li key={label}>
              <button type="button" aria-pressed={category === label}
                className={`flex h-7 w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent ${category === label ? "bg-accent/10 text-accent" : ""}`}
                onClick={() => setCategory(current => current === label ? null : label)}>
                {analysis.framework === null && <span className="file-kind" data-extension={label} aria-hidden />}
                <span className={analysis.framework === null ? "font-mono" : ""}>{label}</span>
                <span className="ml-auto tabular-nums text-muted">{files.size}</span>
              </button>
            </li>
          ))}
        </ul>
        {matchingFiles !== null && <p className="border-t border-line px-3 py-2 text-[11px] text-muted">Panel counts show matched / total files. Click the category again to clear.</p>}
      </aside>
      <section aria-label="Repository explorer" className="flex min-h-0 min-w-0 flex-col">
        <div role="tablist" aria-label="Explorer view" className="flex h-9 shrink-0 border-b border-line">
          {(["map", "routes"] as const).map(value => (
            <button key={value} type="button" role="tab" id={`${id}-${value}-tab`} aria-controls={`${id}-${value}-panel`}
              aria-label={value === "map" ? "Map" : `Routes (${analysis.routes.length})`}
              aria-selected={view === value} tabIndex={view === value ? 0 : -1}
              onClick={() => setView(value)}
              onKeyDown={event => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? "map" : event.key === "End" ? "routes" : value === "map" ? "routes" : "map";
                setView(next);
                document.getElementById(`${id}-${next}-tab`)?.focus();
              }}
              className={`cursor-pointer border-b-2 px-3 text-[12px] focus-visible:outline-2 focus-visible:outline-accent ${view === value ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}>
              {value === "map" ? "Map" : <>Routes <span className="ml-1 tabular-nums">{analysis.routes.length}</span></>}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${id}-map-panel`} aria-labelledby={`${id}-map-tab`} hidden={view !== "map"} tabIndex={0} className="min-h-0 flex-1">
          <DependencyMap analysis={analysis} name={name} modules={folded.modules} expanded={expanded}
            matchingFiles={matchingFiles}
            selection={selection} hovered={hovered} onHover={setHovered}
            onSelectFile={selectFile} onToggle={toggle} onDeselect={() => setSelection(null)} />
        </div>
        <div role="tabpanel" id={`${id}-routes-panel`} aria-labelledby={`${id}-routes-tab`} hidden={view !== "routes"} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto">
          <RoutesTable routes={analysis.routes} matchingFiles={matchingFiles} onHover={setHovered}
            onSelectFile={path => {
              selectFile(path);
              setView("map");
              document.getElementById(`${id}-map-tab`)?.focus();
            }} />
        </div>
      </section>
      <DetailPane analysis={analysis} name={name} modules={folded.modules} structure={structure}
        insights={insights}
        selection={selection} hovered={hovered} onHover={setHovered} onSelectFile={selectFile} />
    </>
  );
}
