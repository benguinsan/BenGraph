import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import { RelativeTime } from "@/components/relative-time";
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
  const { sessionClaims } = await auth.protect();
  return (
    <>
      <Heading name={sessionClaims.org_name} />
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
    .select("id, status, commit_sha, started_at, finished_at, projects(repo_url)")
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
            return (
              <tr key={analysis.id} className="border-b border-line">
                <td className="h-8 px-4 font-mono">
                  <span className="text-muted">{owner}/</span>
                  {name}
                </td>
                <td className="h-8 px-4">
                  <Status status={analysis.status} />
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

// Shape carries the state so it reads without colour; only failure is coloured.
const marks: Record<string, React.ReactNode> = {
  queued: <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" />,
  running: (
    <>
      <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" />
      <path d="M5 1.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
    </>
  ),
  complete: <circle cx="5" cy="5" r="4" fill="currentColor" />,
  failed: <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
};

function Status({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${status === "failed" ? "text-danger" : ""}`}>
      <svg viewBox="0 0 10 10" className={`size-2.5 ${status === "failed" ? "" : "text-muted"}`} aria-hidden>
        {marks[status]}
      </svg>
      {status}
    </span>
  );
}

// Blank rather than a placeholder: a queued run hasn't started, a running one hasn't
// finished.
function Time({ iso }: { iso: string | null }) {
  return <td className="h-8 px-4 whitespace-nowrap text-muted tabular-nums">{iso && <RelativeTime iso={iso} />}</td>;
}
