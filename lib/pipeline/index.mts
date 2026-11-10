import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database.ts";
import { parseRepository } from "../parser/index.mts";
import { fetchRepository, normalizeRepositoryUrl } from "./github.mts";

/** Claims once per organization/repository without delaying navigation for the run. */
export async function beginAnalysis(db: SupabaseClient<Database>, input: string): Promise<{ id: string; status: string; created: boolean; started_at: string }> {
  const repoUrl = normalizeRepositoryUrl(input);
  const { data, error } = await db.rpc("begin_analysis", { p_repo_url: repoUrl }).single();
  if (error) throw new Error(`Could not start analysis: ${error.message}`);
  return data;
}

/** Runs once per organization/repository; the supplied client must carry the caller's token. */
export async function analyseRepository(db: SupabaseClient<Database>, input: string): Promise<{ id: string; status: string; created: boolean; started_at: string }> {
  const analysis = await beginAnalysis(db, input);
  if (!analysis.created) return analysis;
  await runAnalysis(db, analysis.id, input, analysis.started_at);
  return { ...analysis, status: "complete" };
}

/** Executes a newly claimed analysis, recording failures before they leave the request. */
export async function runAnalysis(db: SupabaseClient<Database>, id: string, repoUrl: string, startedAt: string): Promise<void> {
  let stage: "fetch" | "select" | "parse" | "store" = "fetch";
  let workspace: string | undefined;

  async function advance(next: typeof stage, message: string, commitSha?: string): Promise<void> {
    const { error } = await db.from("analyses").update({ stage: next, message, ...(commitSha ? { commit_sha: commitSha } : {}) })
      .eq("id", id).eq("status", "running").eq("started_at", startedAt).select("id").single();
    if (error) throw new Error(`Could not record ${next} stage: ${error.message}`);
    stage = next;
  }

  try {
    workspace = await mkdtemp(path.join(tmpdir(), "cartograph-"));
    const commitSha = await fetchRepository(repoUrl, workspace);
    await advance("select", "Selecting repository source files", commitSha);
    const result = await parseRepository(path.join(workspace, "repo"), undefined, () => advance("parse", "Parsing imports and resolving dependencies"));
    await advance("store", "Storing files, edges and coverage");
    const { error } = await db.rpc("store_analysis", {
      p_analysis_id: id,
      p_started_at: startedAt,
      p_result: {
        files: result.files.map(file => ({ ...file })),
        edges: result.edges.map(edge => ({ ...edge })),
        imports: result.imports.map(record => ({ ...record })),
        coverage: { ...result.coverage, skipped: result.coverage.skipped.map(file => ({ ...file })) },
      },
    });
    if (error) throw new Error(`Could not store parser result: ${error.message}`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message || cause.name : String(cause);
    const { error } = await db.rpc("fail_analysis", {
      p_analysis_id: id, p_started_at: startedAt, p_stage: stage, p_error: message,
    });
    if (error) throw new AggregateError([cause, new Error(error.message)], `Analysis ${id} failed during ${stage}; recording the failure also failed: ${error.message}`);
    throw new Error(`Analysis ${id} failed during ${stage}: ${message}`, { cause });
  } finally {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  }
}
