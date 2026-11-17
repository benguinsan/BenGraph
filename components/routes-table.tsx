"use client";

import type { ExtractedRoute } from "@/lib/adapters/types.mts";
import type { Selection } from "@/lib/graph/view.mts";

export function RoutesTable({ routes, matchingFiles, onSelectFile, onHover }: {
  routes: readonly ExtractedRoute[];
  matchingFiles: ReadonlySet<string> | null;
  onSelectFile: (path: string) => void;
  onHover: (selection: Selection) => void;
}) {
  if (routes.length === 0) return <p role="status" className="px-3 py-3 text-[12px] text-muted">No routes extracted.</p>;
  return (
    <table aria-label="Extracted routes" className="w-full table-fixed text-left text-[12px]">
      <thead className="border-b border-line text-[11px] text-muted">
        <tr><th scope="col" className="w-20 px-3 py-2 font-normal">Method</th><th scope="col" className="px-3 py-2 font-normal">Path</th><th scope="col" className="px-3 py-2 font-normal">File</th></tr>
      </thead>
      <tbody>{routes.map(route => (
        <tr key={JSON.stringify([route.method, route.path, route.file])} className="border-b border-line"
          style={{ opacity: matchingFiles === null || matchingFiles.has(route.file) ? 1 : 0.18 }}>
          <td className="px-3 py-2 align-top font-mono">{route.method}</td>
          <td className="break-all px-3 py-2 align-top font-mono">{route.path}</td>
          <td className="px-3 py-2 align-top">
            <button type="button" aria-label={route.file} title={route.file}
              className="cursor-pointer text-left font-mono break-all text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => onSelectFile(route.file)}
              onMouseEnter={() => onHover({ kind: "file", id: route.file })} onMouseLeave={() => onHover(null)}
              onFocus={() => onHover({ kind: "file", id: route.file })} onBlur={() => onHover(null)}>
              {route.file}
            </button>
          </td>
        </tr>
      ))}</tbody>
    </table>
  );
}
