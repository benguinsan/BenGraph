"use client";

import { useId, useState } from "react";
import type { ParseResult } from "@/lib/parser/index.mts";
import { compare, type FoldedModule } from "@/lib/graph/folding.mts";
import type { repositoryStructure } from "@/lib/graph/details.mts";
import type { Selection } from "@/lib/graph/view.mts";

interface DetailProps {
  analysis: ParseResult;
  name: string;
  modules: readonly FoldedModule[];
  structure: ReturnType<typeof repositoryStructure>;
  selection: Selection;
  hovered: Selection;
  onHover: (selection: Selection) => void;
  onSelectFile: (path: string) => void;
}

/** Shows repository, folder or file facts from browser data while preserving the selected tab. */
export function DetailPane({ analysis, name, modules, structure, selection, hovered, onHover, onSelectFile }: DetailProps) {
  const [tab, setTab] = useState<"structure" | "explanation">("structure");
  const id = useId();
  const file = selection?.kind === "file" ? analysis.files.find(file => file.path === selection.id) : undefined;
  const folder = selection?.kind === "folder" ? modules.find(module => module.folder === selection.id) : undefined;
  const neighbours = file ? structure.neighbours.get(file.path) : undefined;
  const hoveredFolder = hovered?.kind === "folder" ? modules.find(module => module.folder === hovered.id) : undefined;
  /** Matches a path against the hovered file or the members of the hovered folded folder. */
  const isHighlighted = (path: string) => hovered?.kind === "file" ? hovered.id === path : hoveredFolder?.files.some(file => file.path === path) ?? false;

  /** Selects a real file and shares hover state, retaining its full path when the label is shortened. */
  function pathButton(path: string, compact = false) {
    const slash = path.lastIndexOf("/") + 1;
    return (
      <button type="button" title={path}
        aria-label={path}
        className={`min-w-0 flex-1 cursor-pointer text-left font-mono hover:text-accent focus-visible:outline-2 focus-visible:outline-accent ${compact ? "flex text-[11px]" : "break-all text-[13px]"} ${isHighlighted(path) ? "bg-accent/10 text-accent" : ""}`}
        onClick={() => onSelectFile(path)}
        onMouseEnter={() => onHover({ kind: "file", id: path })} onMouseLeave={() => onHover(null)}
        onFocus={() => onHover({ kind: "file", id: path })} onBlur={() => onHover(null)}>
        {compact ? <><span className={`truncate ${file ? "text-muted" : ""}`}>{path.slice(0, slash)}</span><span className="max-w-full shrink-0 truncate">{path.slice(slash)}</span></> : <>
          <span className="text-muted">{path.slice(0, slash)}</span><span className="font-semibold">{path.slice(slash)}</span>
        </>}
      </button>
    );
  }

  /** Lists all file neighbours; only repository summaries stop at ten rows and report the remainder. */
  function paths(title: string, rows: readonly { path: string; count?: number }[], note?: string, direction?: "incoming" | "outgoing", summary = false) {
    const List = summary ? "ol" : "ul";
    const visible = summary ? rows.slice(0, 10) : rows;
    return (
      <section className="py-2">
        <h3 className="flex items-baseline gap-2 px-3 text-[12px] font-medium">
          <span>{title}{note && <span className="ml-1.5 text-[11px] font-normal text-muted">{note}</span>}</span>
          <span className={`ml-auto shrink-0 tabular-nums ${direction === "incoming" ? "text-incoming" : direction === "outgoing" ? "text-outgoing" : "text-muted"}`}>
            {!summary && direction === "incoming" && "←"}{rows.length}{!summary && direction === "outgoing" && "→"}
          </span>
        </h3>
        {rows.length === 0 ? <p className="px-3 pt-1 text-[11px] text-muted">None.</p> : (
          <List className="pt-1">
            {visible.map(row => (
              <li key={row.path} className={`flex items-baseline gap-2 px-3 py-1 ${isHighlighted(row.path) ? "bg-accent/10" : ""}`}>
                {pathButton(row.path, true)}
                {row.count !== undefined && <span className={`shrink-0 text-[11px] tabular-nums ${direction === "incoming" ? "text-incoming" : direction === "outgoing" ? "text-outgoing" : "text-muted"}`}>
                  {direction === "incoming" && "←"}{row.count}{direction === "outgoing" && "→"}
                </span>}
              </li>
            ))}
          </List>
        )}
        {rows.length > visible.length && <p className="px-3 pt-1 text-[11px] text-muted">{rows.length - visible.length} more not listed</p>}
      </section>
    );
  }

  const kinds = new Map<string, number>();
  for (const member of folder?.files ?? []) {
    const extension = member.path.slice(member.path.lastIndexOf("."));
    kinds.set(extension, (kinds.get(extension) ?? 0) + 1);
  }

  return (
    <aside aria-label="Repository and selection details" className="flex min-h-0 min-w-0 flex-col border-l border-line bg-raised">
      <div className={`shrink-0 px-3 py-3 ${file ? "" : "border-b border-line"}`}>
        {file ? <>
          <p className="text-[11px] text-muted">file</p>
          <h2 className="mt-1 flex">{pathButton(file.path)}</h2>
        </> : <>
          <h2 className="break-all font-mono text-[14px] font-semibold">{folder ? folder.folder || "Repository root" : name}</h2>
          {folder ? <p className="mt-1 text-[12px] text-muted">Folded folder</p> : (
            <p className="mt-1 text-[12px]"><span className="text-muted">Framework </span>none detected</p>
          )}
        </>}
      </div>
      <div role="tablist" aria-label="Detail view" className="flex h-9 shrink-0 border-b border-line">
        {(["structure", "explanation"] as const).map(value => (
          <button key={value} type="button" role="tab" id={`${id}-${value}`} aria-controls={`${id}-panel`}
            aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "structure" : event.key === "End" ? "explanation" : value === "structure" ? "explanation" : "structure";
              setTab(next);
              document.getElementById(`${id}-${next}`)?.focus();
            }}
            className={`cursor-pointer border-b-2 px-3 text-[12px] capitalize focus-visible:outline-2 focus-visible:outline-accent ${tab === value ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}>
            {value}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:outline-accent">
        {tab === "explanation" ? (
          <p className="px-3 py-3 text-muted">No explanation yet. Explanations will appear here when model calls are available.</p>
        ) : file && neighbours ? (
          <>
            <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-2 gap-y-1 border-b border-line px-3 py-3 text-[12px]">
              <dt className="text-muted">Kind</dt>
              <dd className="flex items-center gap-2 font-mono" title="Unclassified by convention; no framework adapter applied">
                <span className="file-kind" data-extension={file.path.slice(file.path.lastIndexOf("."))} aria-hidden />
                {file.path.slice(file.path.lastIndexOf("."))}
              </dd>
              <dt className="text-muted">Folder</dt><dd className="break-all font-mono">{file.folder || "."}</dd>
              <dt className="text-muted">Length</dt><dd className="tabular-nums">{file.lines} {file.lines === 1 ? "line" : "lines"}</dd>
              <dt className="text-muted">Depends on</dt><dd><span className="tabular-nums text-outgoing">{neighbours.dependencies.length}</span> files</dd>
              <dt className="text-muted">Depended on by</dt><dd><span className="tabular-nums text-incoming">{neighbours.dependents.length}</span> files</dd>
            </dl>
            <div className="space-y-2 py-2">
              {paths("Imports", neighbours.dependencies.map(path => ({ path })), undefined, "outgoing")}
              {paths("Imported by", neighbours.dependents.map(path => ({ path })), undefined, "incoming")}
            </div>
          </>
        ) : folder ? (
          <>
            <dl className="grid grid-cols-3 divide-x divide-line border-b border-line">
              <div className="min-w-0 px-3 py-2.5">
                <dt className="text-[11px] text-muted">Files</dt>
                <dd className="mt-0.5 font-mono text-[18px] leading-tight tabular-nums">{folder.files.length}</dd>
              </div>
              <div className="min-w-0 px-3 py-2.5">
                <dt className="text-[11px] text-muted">Imports</dt>
                <dd className="mt-0.5 font-mono text-[18px] leading-tight tabular-nums text-outgoing">{folder.fanOut}→</dd>
                <dd className="mt-1 text-[11px] text-muted">outside folder</dd>
              </div>
              <div className="min-w-0 px-3 py-2.5">
                <dt className="text-[11px] text-muted">Dependents</dt>
                <dd className="mt-0.5 font-mono text-[18px] leading-tight tabular-nums text-incoming">←{folder.fanIn}</dd>
                <dd className="mt-1 text-[11px] text-muted">outside folder</dd>
              </div>
            </dl>
            <section className="pt-4 pb-2">
              <h3 className="flex items-baseline gap-2 px-3 text-[12px] font-medium">File kinds
                <span className="text-[11px] font-normal text-muted">by extension</span>
                <span className="ml-auto tabular-nums text-muted">{kinds.size}</span>
              </h3>
              <ul className="pt-1">
                {[...kinds].sort(([a], [b]) => compare(a, b)).map(([extension, count]) => {
                  const highlighted = folder.files.some(member => isHighlighted(member.path) && member.path.endsWith(extension));
                  return <li key={extension} className={`flex items-center gap-2 px-3 py-1 ${highlighted ? "bg-accent/10 text-accent" : ""}`}>
                    <span className="file-kind" data-extension={extension} aria-hidden /><span className="font-mono text-[11px]">{extension}</span>
                    <span className="ml-auto text-[11px] tabular-nums text-muted">{count}</span>
                  </li>;
                })}
              </ul>
            </section>
            <section className="px-3 py-2 text-[11px] text-muted">
              <h3 className="flex gap-2 font-normal">Unidentified by convention<span className="ml-auto tabular-nums text-fg">{folder.files.length}</span></h3>
              <p className="mt-1 leading-relaxed">No framework adapter applied, so no file in this folder was matched to a role.</p>
            </section>
          </>
        ) : (
          <>
            <dl className="grid grid-cols-3 divide-x divide-line border-b border-line">
              <div className="min-w-0 px-3 py-2.5">
                <dt className="text-[11px] text-muted">Files</dt>
                <dd className="mt-0.5 font-mono text-[18px] leading-tight tabular-nums">{analysis.files.length}</dd>
                <dd className="mt-1 text-[11px] text-muted">{analysis.coverage.filesSkipped} skipped</dd>
              </div>
              <div className="min-w-0 px-3 py-2.5">
                <dt className="text-[11px] text-muted">Imports</dt>
                <dd className="mt-0.5 font-mono text-[18px] leading-tight tabular-nums">{analysis.coverage.importsSeen}</dd>
                <dd className="mt-1 text-[11px] text-muted">{analysis.coverage.importsUnresolved} unresolved</dd>
              </div>
              <div className="min-w-0 px-3 py-2.5">
                <dt className="text-[11px] text-muted">Routes</dt>
                <dd className="mt-0.5 font-mono text-[18px] leading-tight text-muted" aria-label="Not available">—</dd>
                <dd className="mt-1 text-[11px] text-muted">no adapter</dd>
              </div>
            </dl>
            <div className="py-2">
              {paths("Most depended on", structure.mostImported, "by files importing it", "incoming", true)}
              {paths("Imported by nothing", structure.entryPoints, "where reading starts", "outgoing", true)}
              <section className="px-3 py-2 text-[11px] text-muted">
                <h3 className="flex gap-2 font-normal">Unidentified by convention<span className="ml-auto tabular-nums text-fg">{analysis.files.length}</span></h3>
                <p className="mt-1 leading-relaxed">No framework adapter applied, so no file was matched to a role.</p>
              </section>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
