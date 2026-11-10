import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import Link from "next/link";
import { AnalysisStatus } from "@/components/analysis-status";
import { LiveRefresh } from "@/components/live-refresh";
import { RepositoryForm } from "@/components/repository-form";
import { RelativeTime } from "@/components/relative-time";
import { staleDeadline } from "@/lib/progress.mts";
import { createSupabaseClient } from "@/lib/supabase";

export default function WorkspacePage() {
  return (
    <div className="flex h-full flex-col">
      <Suspense fallback={<Heading />}>
        <Workspace />
      </Suspense>
    </div>
  );
}

// Comes off the session token's claims, so the name is in the server-rendered HTML
// and nothing asks Clerk a question at request time.
async function Workspace() {
  const { sessionClaims, orgId } = await auth.protect();
  return (
    <>
      <Heading name={sessionClaims.org_name} />
      <RepositoryForm />
      {orgId && <LiveRefresh key={orgId} topic={`organization:${orgId}:analyses`} />}
      <Suspense fallback={<Notice>Loading analyses…</Notice>}>
        <Analyses />
      </Suspense>
    </>
  );
}

function Heading({ name, count }: { name?: string; count?: number }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-4">
      <h1 className="font-medium">{name}</h1>
      {count !== undefined && (
        <span className="ml-auto text-muted tabular-nums">
          {count} {count === 1 ? "analysis" : "analyses"}
        </span>
      )}
    </div>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "danger" }) {
  return <p className={`px-4 py-3 ${tone === "danger" ? "text-danger" : "text-muted"}`}>{children}</p>;
}

// No organization filter here on purpose: the row-level security policy reads the
// organization off the token. If another team's row ever shows up, fix the policy.
async function Analyses() {
  const supabase = await createSupabaseClient();
  const { data, error } = await supabase
    .from("analyses")
    .select("id, status, stage, message, error, created_at, commit_sha, started_at, finished_at, projects(repo_url)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return <Notice tone="danger">Couldn&apos;t load analyses: {error.message}</Notice>;

  if (data.length === 0) {
    return <Notice>This team hasn&apos;t analysed a repository yet.</Notice>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 bg-surface text-muted">
          <tr className="border-b border-line">
            <th className="h-7 px-4 font-normal">Repository</th>
            <th className="h-7 w-32 px-4 font-normal">State</th>
            <th className="h-7 w-24 px-4 font-normal">Commit</th>
            <th className="h-7 w-28 px-4 font-normal">Started</th>
            <th className="h-7 w-28 px-4 font-normal">Finished</th>
          </tr>
        </thead>
        <tbody>
          {data.map((analysis) => {
            const [owner, name] = analysis.projects.repo_url.replace("https://github.com/", "").split("/");
            const deadline = staleDeadline(analysis.created_at, analysis.started_at);
            return (
              <tr key={analysis.id} className="border-b border-line">
                <td className="h-8 px-4 font-mono">
                  <Link href={`/analyses/${analysis.id}`} className="hover:underline">
                    <span className="text-muted">{owner}/</span>{name}
                  </Link>
                </td>
                <td className="h-8 px-4">
                  <AnalysisStatus status={analysis.status} stage={analysis.stage} deadline={deadline}
                    message={analysis.error ?? analysis.message} />
                </td>
                {/* Empty until the archive is fetched; a run that failed before then has none. */}
                <td className="h-8 px-4 font-mono text-muted" title={analysis.commit_sha ?? undefined}>
                  {analysis.commit_sha?.slice(0, 7)}
                </td>
                <Time iso={analysis.started_at} />
                <Time iso={analysis.finished_at} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Blank rather than a placeholder: a queued run hasn't started, a running one hasn't
// finished.
function Time({ iso }: { iso: string | null }) {
  return <td className="h-8 px-4 whitespace-nowrap text-muted tabular-nums">{iso && <RelativeTime iso={iso} />}</td>;
}
