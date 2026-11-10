import type { StoredAnalysis } from "@/lib/parser/index.mts";
import { coverageSummary } from "@/lib/coverage.mts";

export function CoverageBanner({ analysis }: { analysis: StoredAnalysis }) {
  const coverage = analysis.coverage;
  const { percentage, consideredImports, partial } = coverageSummary(coverage);
  const missing = analysis.imports.filter(record => record.status === "unresolved" || record.status === "excluded");
  return <details open={partial} className="shrink-0 border-b border-line px-4 text-[11px]">
    <summary className="cursor-pointer py-2">
      {partial && <strong className="mr-2 font-medium">Partial graph</strong>}
      Import coverage {percentage}% · {coverage.filesParsed}/{coverage.filesFound} files parsed
    </summary>
    <div className="max-h-48 overflow-auto pb-3 text-muted">
      <p>{coverage.importsResolved}/{consideredImports} imports mapped · {coverage.importsOutside} outside repository · {coverage.importsExcluded} excluded · {coverage.importsUnresolved} unresolved · {coverage.filesSkipped} files skipped.</p>
      <p className="mt-1">Known external imports are excluded from the percentage. Missing imports and skipped files are not drawn.</p>
      {missing.length > 0 && <ul className="mt-2 space-y-1" aria-label="Unmapped imports">
        {missing.slice(0, 10).map((record, index) => <li key={index}>
          <code>{record.from} → {record.specifier}</code>: {record.reason}
        </li>)}
        {missing.length > 10 && <li>{missing.length - 10} more unmapped imports.</li>}
      </ul>}
      {coverage.skipped.length > 0 && <ul className="mt-2 space-y-1" aria-label="Skipped files">
        {coverage.skipped.slice(0, 10).map(file => <li key={file.path}><code>{file.path}</code>: {file.reason}</li>)}
        {coverage.skipped.length > 10 && <li>{coverage.skipped.length - 10} more skipped files.</li>}
      </ul>}
    </div>
  </details>;
}
