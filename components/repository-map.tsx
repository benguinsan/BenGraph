"use client";

import { useCallback, useMemo, useState } from "react";
import type { ParseResult } from "@/lib/parser/index.mts";
import { foldFiles } from "@/lib/graph/folding.mts";
import { repositoryStructure } from "@/lib/graph/details.mts";
import type { Selection } from "@/lib/graph/view.mts";
import { DependencyMap } from "./dependency-map";
import { DetailPane } from "./detail-pane";

export function RepositoryMap({ analysis, name, examples = [] }: { analysis: ParseResult; name: string; examples?: readonly string[] }) {
  const [selection, setSelection] = useState<Selection>(null);
  const [hovered, setHovered] = useState<Selection>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const folded = useMemo(() => foldFiles(analysis.files, analysis.edges), [analysis]);
  const structure = useMemo(() => repositoryStructure(analysis.files, analysis.edges), [analysis]);

  const selectFile = useCallback((path: string) => {
    const owner = folded.modules.find(module => module.files.some(file => file.path === path));
    if (!owner) throw new Error(`Selected file is missing: ${path}`);
    setExpanded(current => current.has(owner.folder) ? current : new Set([...current, owner.folder]));
    setSelection({ kind: "file", id: path });
    setHovered(null);
  }, [folded]);

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
      <section aria-label="Dependency map" className="flex min-h-0 min-w-0 flex-col">
        {examples.length > 0 && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-[11px]">
            <span className="text-muted">Real examples</span>
            {examples.map(path => {
              const neighbours = structure.neighbours.get(path);
              if (!neighbours) throw new Error(`Example file is missing: ${path}`);
              const selected = selection?.kind === "file" && selection.id === path;
              return (
                <button key={path} type="button" title={path} aria-label={path} aria-pressed={selected}
                  className={`flex cursor-pointer items-center gap-2 rounded-sm border px-2 py-1 hover:border-accent focus-visible:outline-2 focus-visible:outline-accent ${selected ? "border-accent bg-accent/10" : "border-line bg-raised"}`}
                  onClick={() => selectFile(path)}
                  onMouseEnter={() => setHovered({ kind: "file", id: path })} onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered({ kind: "file", id: path })} onBlur={() => setHovered(null)}>
                  <span className="font-mono">{path.slice(path.lastIndexOf("/") + 1)}</span>
                  <span className="tabular-nums text-incoming" title="Dependents">←{neighbours.dependents.length}</span>
                  <span className="tabular-nums text-outgoing" title="Imports">{neighbours.dependencies.length}→</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <DependencyMap analysis={analysis} modules={folded.modules} expanded={expanded}
            selection={selection} hovered={hovered} onHover={setHovered}
            onSelectFile={selectFile} onToggle={toggle} onDeselect={() => setSelection(null)} />
        </div>
      </section>
      <DetailPane analysis={analysis} name={name} modules={folded.modules} structure={structure}
        selection={selection} hovered={hovered} onHover={setHovered} onSelectFile={selectFile} />
    </>
  );
}
