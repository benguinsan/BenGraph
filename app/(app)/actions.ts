"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { isAnalysisId, readAnalysis } from "@/lib/analysis-data";
import { analysisProgress, type ProgressUpdate } from "@/lib/progress.mts";
import { beginAnalysis, runAnalysis } from "@/lib/pipeline/index.mts";
import { createRunSupabaseClient } from "@/lib/supabase";

export async function submitRepository(_previous: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const { orgId } = await auth.protect();
  if (!orgId) return { error: "Choose an organization before analysing a repository." };
  const url = formData.get("repository");
  if (typeof url !== "string") return { error: "Enter a public GitHub repository URL." };
  let id: string;
  try {
    const db = await createRunSupabaseClient();
    const analysis = await beginAnalysis(db, url);
    id = analysis.id;
    if (analysis.created) {
      // Capture the authenticated client before the response ends.
      after(async () => {
        try { await runAnalysis(db, analysis.id, url, analysis.started_at); }
        catch (error) { console.error(error); }
      });
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not start analysis." };
  }
  redirect(`/analyses/${id}`);
}

export async function readProgress(id: string): Promise<ProgressUpdate> {
  await auth.protect();
  if (!isAnalysisId(id)) throw new Error("Analysis not found.");
  const { data, error } = await readAnalysis(id);
  if (error) throw new Error(`Could not read progress: ${error.message}`);
  if (!data) throw new Error("Analysis not found in this organization.");
  return analysisProgress(data);
}

export async function reanalyseRepository(_previous: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const { orgId } = await auth.protect();
  if (!orgId) return { error: "Choose an organization before analysing a repository." };
  const id = formData.get("analysis");
  if (typeof id !== "string" || !isAnalysisId(id)) return { error: "Analysis not found." };
  try {
    const { data: existing, error: readError } = await readAnalysis(id);
    if (readError) throw new Error(readError.message);
    if (!existing) return { error: "Analysis not found in this organization." };
    const db = await createRunSupabaseClient();
    const { data: run, error } = await db.rpc("restart_analysis", { p_analysis_id: id }).single();
    if (error) throw new Error(error.message);
    after(async () => {
      try { await runAnalysis(db, id, existing.projects.repo_url, run.started_at); }
      catch (error) { console.error(error); }
    });
    revalidatePath(`/analyses/${id}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not restart analysis." };
  }
  redirect(`/analyses/${id}`);
}
