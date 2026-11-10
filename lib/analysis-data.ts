import "server-only";
import { createSupabaseClient } from "@/lib/supabase";
import { isStoredAnalysis, type StoredAnalysis } from "@/lib/parser/index.mts";

export type StoredResult = StoredAnalysis & { commit_sha: string };

export function isAnalysisId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export async function readAnalysis(id: string) {
  const db = await createSupabaseClient();
  return db.from("analyses")
    .select("id, status, stage, message, error, commit_sha, created_at, started_at, finished_at, projects(repo_url)")
    .eq("id", id).maybeSingle();
}

export async function readAnalysisResult(id: string): Promise<StoredResult | null> {
  const db = await createSupabaseClient();
  const { data, error } = await db.rpc("read_analysis_result", { p_analysis_id: id });
  if (error) throw new Error(`Could not load stored graph: ${error.message}`);
  if (data === null) return null;
  if (!isStoredAnalysis(data) || !("commit_sha" in data) || typeof data.commit_sha !== "string") {
    throw new Error("Stored parser result is incomplete or invalid. Re-analyse this repository.");
  }
  return { ...data, commit_sha: data.commit_sha };
}
