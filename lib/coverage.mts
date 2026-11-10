import type { StoredAnalysis } from "./parser/index.mts";

export function coverageSummary(coverage: StoredAnalysis["coverage"]) {
  const consideredImports = coverage.importsSeen - coverage.importsOutside;
  // Truncate so a partial result cannot round up to a reassuring 100%.
  const percentage = consideredImports === 0 ? 100 : Math.floor(coverage.importsResolved * 1000 / consideredImports) / 10;
  return { consideredImports, percentage,
    partial: coverage.filesSkipped > 0 || coverage.importsUnresolved > 0 || coverage.importsExcluded > 0 };
}
