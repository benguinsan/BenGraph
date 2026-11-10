"use client";

import { useEffect, useState } from "react";

const marks: Record<string, React.ReactNode> = {
  queued: <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" />,
  running: <><circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" /><path d="M5 1.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" /></>,
  complete: <circle cx="5" cy="5" r="4" fill="currentColor" />,
  failed: <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
};

export function AnalysisStatus({ status, stage, deadline, message }: {
  status: string; stage: string | null; deadline: number; message?: string | null;
}) {
  const [expiredDeadline, setExpiredDeadline] = useState<number | null>(null);
  const unfinished = status === "queued" || status === "running";
  const stale = unfinished && expiredDeadline === deadline;
  useEffect(() => {
    if (!unfinished) return;
    // One local timer marks abandonment; it never queries the database.
    const timer = setTimeout(() => setExpiredDeadline(deadline), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline, unfinished]);
  const label = status === "running" ? stage ?? status : status;
  return (
    <span title={stale ? "This run is unfinished more than five minutes after it started." : message ?? undefined}
      className={`inline-flex items-center gap-1.5 ${status === "failed" ? "text-danger" : ""}`}>
      <svg viewBox="0 0 10 10" className={`size-2.5 ${status === "failed" ? "" : "text-muted"}`} aria-hidden>
        {marks[status]}
      </svg>
      {stale ? `stale · ${label}` : label}
    </span>
  );
}
