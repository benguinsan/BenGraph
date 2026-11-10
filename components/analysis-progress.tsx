"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readProgress } from "@/app/(app)/actions";
import { runStages, stageNames, type ProgressUpdate } from "@/lib/progress.mts";
import { subscribeToProgress } from "@/lib/realtime.mts";
import { useAuthenticatedSupabase } from "@/lib/supabase-browser";
import { AnalysisStatus } from "./analysis-status";

export function AnalysisProgress({ id, initial, deadline }: {
  id: string; initial: ProgressUpdate; deadline: number;
}) {
  const db = useAuthenticatedSupabase();
  const router = useRouter();
  const [progress, setProgress] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const finished = progress.stage === "complete" || progress.stage === "failed";
  useEffect(() => {
    if (finished) return;
    return subscribeToProgress(db, `analysis:${id}`, {
      onProgress: progress => {
        setProgress(progress);
        if (progress.stage === "complete") window.location.replace(`/analyses/${id}`);
        else if (progress.stage === "failed") router.refresh();
      }, onError: setError, readSnapshot: () => readProgress(id),
    });
  }, [db, id, finished, router]);
  const current = runStages.findIndex(stage => stage === progress.stage);
  return (
    <div className="max-w-2xl px-4 py-4">
      <div role="status" aria-live="polite" aria-atomic="true" className="mb-4">
        <h1 className="mb-1 font-medium">
          <AnalysisStatus status={finished ? progress.stage : progress.stage === "queued" ? "queued" : "running"}
            stage={progress.stage} deadline={deadline} message={progress.message} />
        </h1>
        <p className={progress.stage === "failed" ? "text-danger" : "text-muted"}>{progress.message}</p>
      </div>
      <ol className="divide-y divide-line border-y border-line" aria-label="Analysis stages">
        {runStages.map((stage, index) => {
          const done = progress.stage === "complete" || current > index;
          const active = stage === progress.stage;
          return <li key={stage} aria-current={active ? "step" : undefined}
            className={`flex h-9 items-center gap-3 ${active ? "text-accent" : done ? "" : "text-muted"}`}>
            <span className="w-4 font-mono tabular-nums" aria-hidden>{index + 1}</span>
            <span>{stageNames[stage]}</span>
            <span className="ml-auto">{done ? "Done" : active ? "Current" : current >= 0 || progress.stage === "queued" ? "Waiting" : ""}</span>
          </li>;
        })}
      </ol>
      {error && <p role="alert" className="mt-3 text-danger">
        {error}. <button className="underline" onClick={() => router.refresh()}>Refresh status</button>
      </p>}
    </div>
  );
}
