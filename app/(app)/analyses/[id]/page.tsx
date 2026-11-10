import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AnalysisProgress } from "@/components/analysis-progress";
import { CoverageBanner } from "@/components/coverage-banner";
import { ReanalyseForm } from "@/components/reanalyse-form";
import { RepositoryMap } from "@/components/repository-map";
import { LiveRefresh } from "@/components/live-refresh";
import { isAnalysisId, readAnalysis, readAnalysisResult, type StoredResult } from "@/lib/analysis-data";
import { analysisProgress, staleDeadline } from "@/lib/progress.mts";

export default function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p className="px-4 py-3 text-muted">Loading analysis…</p>}>
    <Progress params={params} />
  </Suspense>;
}

async function Progress({ params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const { id } = await params;
  if (!isAnalysisId(id)) notFound();
  const { data, error } = await readAnalysis(id);
  if (error) return <p role="alert" className="px-4 py-3 text-danger">Couldn&apos;t load analysis: {error.message}</p>;
  if (!data) notFound();
  const deadline = staleDeadline(data.created_at, data.started_at);
  let result: StoredResult | null = null;
  let resultError: string | null = null;
  if (data.status === "complete") {
    try { result = await readAnalysisResult(id); }
    catch (error) { resultError = error instanceof Error ? error.message : "Could not load stored graph."; }
  }
  const name = data.projects.repo_url.replace("https://github.com/", "");
  const commit = result?.commit_sha ?? data.commit_sha;
  return <div className="flex h-full min-w-192 flex-col overflow-x-auto">
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-1">
      <Link href="/" className="text-accent">Dashboard</Link>
      <span className="truncate font-mono">{name}</span>
      {commit && <span title={commit} className="font-mono text-muted">{commit.slice(0, 7)}</span>}
      <ReanalyseForm id={id} status={data.status} deadline={deadline} />
    </div>
    {/* Joining also refreshes lifecycle if a restart raced the two server reads. */}
    {data.status === "complete" && <LiveRefresh topic={`analysis:${id}`} />}
    {data.status === "complete" ? result ? <>
      <CoverageBanner analysis={result} />
      <div className="grid min-h-0 flex-1 grid-cols-[11rem_minmax(19rem,1fr)_clamp(18rem,32vw,28rem)]">
        <RepositoryMap analysis={result} name={name} />
      </div>
    </> : <p role="alert" className="px-4 py-3 text-danger">
      {resultError ?? "No stored parser result is available. Re-analyse this repository to create its map."}
    </p> : <AnalysisProgress key={`${id}:${data.started_at}:${data.status}:${data.stage}:${data.message}`} id={id}
      initial={analysisProgress(data)} deadline={deadline} />}
  </div>;
}
