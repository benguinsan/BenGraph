"use client";

import { useActionState, useEffect, useState } from "react";
import { reanalyseRepository } from "@/app/(app)/actions";

export function ReanalyseForm({ id, status, deadline }: { id: string; status: string; deadline: number }) {
  const [state, action, pending] = useActionState(reanalyseRepository, { error: null });
  const [expiredDeadline, setExpiredDeadline] = useState<number | null>(null);
  const unfinished = status === "queued" || status === "running";
  const allowed = !unfinished || expiredDeadline === deadline;
  useEffect(() => {
    if (!unfinished) return;
    const timer = setTimeout(() => setExpiredDeadline(deadline), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline, unfinished]);
  return <form action={action} className="ml-auto flex flex-wrap items-center gap-2">
    <input type="hidden" name="analysis" value={id} />
    <button type="submit" disabled={pending || !allowed}
      title={allowed ? "Fetch the latest commit and replace this graph when parsing succeeds" : "Available when this run finishes or becomes stale"}
      className="rounded-sm border border-line px-2 py-1 text-accent disabled:text-muted">
      {pending ? "Starting…" : "Re-analyse"}
    </button>
    {state.error && <span role="alert" className="text-danger">{state.error}</span>}
  </form>;
}
