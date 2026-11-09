"use client";

import { useState, type ReactNode } from "react";
import { HIGH_FAN_IN, LONG_FILE_LINES, type repositoryInsights } from "@/lib/graph/analysis.mts";

type RenderPath = (path: string) => ReactNode;

/** Shows a selectable cycle entry and mounts its complete, ordered import path only when expanded. */
function Cycle({ cycle, renderPath }: { cycle: readonly string[]; renderPath: RenderPath }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={event => setOpen(event.currentTarget.open)} className="border-t border-line">
      <summary className="cursor-pointer px-3 py-1 text-[11px] focus-visible:outline-2 focus-visible:outline-accent">
        <span className="inline-flex max-w-full align-middle">{renderPath(cycle[0])}</span>
        <span className="ml-2 text-muted">{cycle.length - 1} imports</span>
      </summary>
      {open && <ol className="pb-2">
        {cycle.map((path, index) => <li key={index} className="flex items-baseline gap-2 px-3 py-1">
          <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-muted" aria-hidden>{index === 0 ? "" : "→"}</span>
          {renderPath(path)}
        </li>)}
      </ol>}
    </details>
  );
}

/** Keeps factual insights collapsed initially and prevents nested cycle disclosures from changing the panel's open state. */
export function InsightsPanel({ insights, renderPath }: { insights: ReturnType<typeof repositoryInsights>; renderPath: RenderPath }) {
  const [open, setOpen] = useState(false);

  /** Lists every matching path with its optional measured count, explicitly reporting empty insight groups. */
  function files(title: string, sentence: string, rows: readonly { path: string; count: number }[], unit?: string) {
    return <section className="border-t border-line py-2">
      <h3 className="flex gap-2 px-3 text-[12px] font-medium">{title}<span className="ml-auto tabular-nums text-muted">{rows.length}</span></h3>
      <p className="px-3 pt-1 text-[11px] text-muted">{sentence}</p>
      {rows.length === 0 ? <p className="px-3 pt-1 text-[11px] text-muted">None.</p> : <ul className="pt-1">
        {rows.map(row => <li key={row.path} className="flex items-baseline gap-2 px-3 py-1">
          {renderPath(row.path)}
          {unit && <span className="shrink-0 text-[10px] tabular-nums text-muted">{row.count} {unit}</span>}
        </li>)}
      </ul>}
    </section>;
  }

  return (
    <details className="max-h-[45%] shrink-0 overflow-y-auto border-t border-line"
      onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
      <summary className="sticky top-0 z-10 cursor-pointer bg-raised px-3 py-2 text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-accent">Insights</summary>
      {open && <>
        {files("Imported by nothing", "No parsed file imports these files; convention entry files are excluded.", insights.unimported)}
        {files("Frequently imported", `These files are imported by at least ${HIGH_FAN_IN} distinct files.`, insights.highFanIn, "importers")}
        <section className="border-t border-line py-2">
          <h3 className="flex gap-2 px-3 text-[12px] font-medium">Import cycle examples<span className="ml-auto tabular-nums text-muted">{insights.cycles.length}</span></h3>
          <p className="px-3 py-1 text-[11px] text-muted">These example paths follow imports back to their starting file; overlapping cycles may exist.</p>
          {insights.cycles.length === 0 ? <p className="px-3 text-[11px] text-muted">None.</p>
            : insights.cycles.map(cycle => <Cycle key={JSON.stringify(cycle)} cycle={cycle} renderPath={renderPath} />)}
        </section>
        {files("Long files", `These files contain more than ${LONG_FILE_LINES} lines.`, insights.longFiles, "lines")}
      </>}
    </details>
  );
}
