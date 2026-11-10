import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { analysisProgress } from "../lib/progress.mts";
import type { readProgress, submitRepository, reanalyseRepository } from "../app/(app)/actions.ts";

function actionFixture({ created = true, orgId = "org_test", missing = false, restartFails = false }: {
  created?: boolean; orgId?: string | null; missing?: boolean; restartFails?: boolean;
} = {}) {
  const exported: { submitRepository?: typeof submitRepository; readProgress?: typeof readProgress; reanalyseRepository?: typeof reanalyseRepository } = {};
  const scheduled: (() => Promise<void>)[] = [];
  const invalidated: string[] = [];
  let runs = 0;
  let claims = 0;
  let reads = 0;
  let authenticated = 0;
  const id = "00000000-0000-4000-8000-000000000001";
  const startedAt = "2026-11-10T10:00:00.123456+00:00";
  const modules: Record<string, unknown> = {
    "@clerk/nextjs/server": { auth: { protect: async () => { authenticated++; return { orgId }; } } },
    "next/navigation": { redirect: (url: string) => { throw new Error(`redirect:${url}`); } },
    "next/server": { after: (callback: () => Promise<void>) => scheduled.push(callback) },
    "next/cache": { revalidatePath: (path: string) => invalidated.push(path) },
    "@/lib/supabase": { createRunSupabaseClient: async () => ({ rpc: (name: string, args: unknown) => {
      assert.equal(name, "restart_analysis");
      assert.equal(JSON.stringify(args), JSON.stringify({ p_analysis_id: id }));
      return { single: async () => restartFails ? { data: null, error: { message: "This analysis is still running" } }
        : { data: { id, started_at: startedAt }, error: null } };
    } }) },
    "@/lib/pipeline/index.mts": {
      beginAnalysis: async () => { claims++; return { id, status: "running", created, started_at: startedAt }; },
      runAnalysis: async (_db: unknown, runId: string, _url: string, start: string) => {
        assert.equal(runId, id); assert.equal(start, startedAt); runs++;
      },
    },
    "@/lib/analysis-data": {
      isAnalysisId: (value: string) => value === id,
      readAnalysis: async () => {
        reads++;
        return { data: missing ? null : { status: "running", stage: "parse", message: "Parsing", error: null,
          projects: { repo_url: "https://github.com/owner/repo" } }, error: null };
      },
    },
    "@/lib/progress.mts": { analysisProgress },
  };
  const source = readFileSync(new URL("../app/(app)/actions.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports: exported, console,
    require(name: string) {
      if (!(name in modules)) throw new Error(`Missing test dependency: ${name}`);
      return modules[name];
    },
  });
  assert.ok(exported.submitRepository);
  assert.ok(exported.readProgress);
  assert.ok(exported.reanalyseRepository);
  return { submit: exported.submitRepository, snapshot: exported.readProgress, restart: exported.reanalyseRepository, scheduled, invalidated, id,
    counts: () => ({ runs, claims, reads, authenticated }) };
}

test("form redirects before running; duplicate submissions do not schedule another run", async () => {
  const form = new FormData();
  form.set("repository", "https://github.com/owner/repo");
  const fixture = actionFixture();
  await assert.rejects(fixture.submit({ error: null }, form), new RegExp(`redirect:/analyses/${fixture.id}`));
  assert.equal(fixture.counts().runs, 0);
  assert.equal(fixture.scheduled.length, 1);
  await fixture.scheduled[0]();
  assert.equal(fixture.counts().runs, 1);
  const duplicate = actionFixture({ created: false });
  await assert.rejects(duplicate.submit({ error: null }, form), /redirect:/);
  assert.equal(duplicate.scheduled.length, 0);
});

test("explicit re-analysis reuses the analysis and refuses unavailable or active runs", async () => {
  const fixture = actionFixture();
  const form = new FormData();
  form.set("analysis", fixture.id);
  await assert.rejects(fixture.restart({ error: null }, form), new RegExp(`redirect:/analyses/${fixture.id}`));
  assert.equal(fixture.scheduled.length, 1);
  assert.deepEqual(fixture.invalidated, [`/analyses/${fixture.id}`]);
  await fixture.scheduled[0]();
  assert.equal(fixture.counts().runs, 1);
  const active = actionFixture({ restartFails: true });
  assert.match((await active.restart({ error: null }, form)).error ?? "", /still running/);
  assert.equal(active.scheduled.length, 0);
  const unavailable = actionFixture({ missing: true });
  assert.match((await unavailable.restart({ error: null }, form)).error ?? "", /not found in this organization/);
  assert.equal(unavailable.scheduled.length, 0);
});

test("form requires an active organization and a URL value before claiming a run", async () => {
  const noOrg = actionFixture({ orgId: null });
  assert.match((await noOrg.submit({ error: null }, new FormData())).error ?? "", /Choose an organization/);
  assert.equal(noOrg.counts().claims, 0);
  const missingUrl = actionFixture();
  assert.match((await missingUrl.submit({ error: null }, new FormData())).error ?? "", /repository URL/);
  assert.equal(missingUrl.counts().claims, 0);
});

test("snapshot authenticates and refuses an absent or invalid analysis", async () => {
  const fixture = actionFixture();
  assert.deepEqual(await fixture.snapshot(fixture.id), { stage: "parse", message: "Parsing" });
  assert.equal(fixture.counts().authenticated, 1);
  await assert.rejects(fixture.snapshot("invalid"), /not found/);
  assert.equal(fixture.counts().reads, 1);
  const absent = actionFixture({ missing: true });
  await assert.rejects(absent.snapshot(absent.id), /not found in this organization/);
});
