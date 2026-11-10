export const runStages = ["fetch", "select", "parse", "store"] as const;
export type ProgressStage = typeof runStages[number] | "queued" | "running" | "complete" | "failed";
export interface ProgressUpdate { stage: ProgressStage; message: string }

export const stageNames: Record<ProgressStage, string> = {
  queued: "Queued", running: "Running", fetch: "Fetch", select: "Select",
  parse: "Parse", store: "Store", complete: "Complete", failed: "Failed",
};

const defaultMessages: Record<ProgressStage, string> = {
  queued: "Waiting to start", running: "Run started; no stage recorded",
  fetch: "Fetching repository archive", select: "Selecting repository source files",
  parse: "Parsing imports and resolving dependencies", store: "Storing files, edges and coverage",
  complete: "Analysis complete", failed: "No failure reason recorded",
};

export function isProgressUpdate(value: unknown): value is ProgressUpdate {
  return typeof value === "object" && value !== null && "stage" in value &&
    typeof value.stage === "string" && Object.hasOwn(stageNames, value.stage) &&
    "message" in value && typeof value.message === "string";
}

export function analysisProgress(row: { status: string; stage: string | null; message: string | null; error: string | null }): ProgressUpdate {
  const stage = row.status === "running" ? row.stage ?? "running" : row.status;
  const progress = { stage, message: row.message ?? "" };
  if (!isProgressUpdate(progress)) throw new Error(`Unknown analysis stage: ${stage}`);
  progress.message = stage === "failed"
    ? `Failed during ${row.stage ?? "run"}: ${row.error ?? row.message ?? defaultMessages.failed}`
    : row.message ?? defaultMessages[progress.stage];
  return progress;
}

export function staleDeadline(createdAt: string, startedAt: string | null): number {
  return Date.parse(startedAt ?? createdAt) + 5 * 60_000;
}
