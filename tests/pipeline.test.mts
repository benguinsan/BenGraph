import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { fetchRepository, normalizeRepositoryUrl } from "../lib/pipeline/github.mts";
import { analyseRepository, beginAnalysis } from "../lib/pipeline/index.mts";
import { parseRepository } from "../lib/parser/index.mts";

const run = promisify(execFile);
const sha = "a".repeat(40);
const startedAt = "2026-11-10T10:00:00.123456+00:00";

function databaseFixture({ existing = false, storeFails = false, failureWriteFails = false } = {}) {
  const updates: Record<string, unknown>[] = [];
  const failures: Record<string, unknown>[] = [];
  const results: unknown[] = [];
  const db = createClient<Database>("https://database.example", "test-key", {
    accessToken: async () => "test-session",
    global: { fetch: async (input, init) => {
      const url = String(input);
      const payload: unknown = JSON.parse(String(init?.body));
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-session");
      if (url.includes("/rpc/fail_analysis")) {
        assert.ok(typeof payload === "object" && payload !== null && !Array.isArray(payload));
        failures.push({ ...payload });
        assert.ok("p_started_at" in payload && payload.p_started_at === startedAt);
        return failureWriteFails ? Response.json({ message: "database unavailable" }, { status: 400 }) : new Response(null, { status: 204 });
      }
      if (url.includes("/rpc/begin_analysis")) {
        assert.deepEqual(payload, { p_repo_url: "https://github.com/owner/repo" });
        return Response.json({ id: "test-analysis", status: existing ? "complete" : "running", created: !existing, started_at: startedAt });
      }
      if (url.includes("/rpc/store_analysis")) {
        results.push(payload);
        return storeFails ? Response.json({ message: "storage refused" }, { status: 400 }) : new Response(null, { status: 204 });
      }
      assert.ok(typeof payload === "object" && payload !== null && !Array.isArray(payload));
      assert.match(url, /analyses\?id=eq.test-analysis&status=eq.running/);
      assert.equal(new URL(url).searchParams.get("started_at"), `eq.${startedAt}`);
      updates.push({ ...payload });
      return Response.json({ id: "test-analysis" });
    } },
  });
  return { db, updates, failures, results };
}

test("claiming an analysis returns its ID before starting the fetch", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Fetch must wait for the response"); });
  const fixture = databaseFixture();
  assert.deepEqual(await beginAnalysis(fixture.db, "https://github.com/OWNER/Repo.git"), { id: "test-analysis", status: "running", created: true, started_at: startedAt });
  assert.equal(fixture.updates.length, 0);
  assert.equal(fixture.results.length, 0);
});

test("duplicate submission returns the existing analysis without fetching", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not fetch"); });
  const fixture = databaseFixture({ existing: true });
  assert.deepEqual(await analyseRepository(fixture.db, "https://github.com/OWNER/Repo.git"), { id: "test-analysis", status: "complete", created: false, started_at: startedAt });
  assert.equal(fixture.updates.length, 0);
});

test("records fetch failure with its stage and reason", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Missing", { status: 404 }));
  const fixture = databaseFixture();
  await assert.rejects(analyseRepository(fixture.db, "https://github.com/owner/repo"), /failed during fetch.*not found/i);
  assert.equal(fixture.failures[0]?.p_stage, "fetch");
  assert.match(String(fixture.failures[0]?.p_error), /not found/i);
  assert.equal(fixture.results.length, 0);
});

test("failure to record a failed run is reported loudly", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Missing", { status: 404 }));
  const fixture = databaseFixture({ failureWriteFails: true });
  await assert.rejects(analyseRepository(fixture.db, "https://github.com/owner/repo"), /recording the failure also failed.*database unavailable/);
});

test("canonicalizes GitHub repository URLs and refuses other inputs", () => {
  assert.equal(normalizeRepositoryUrl("https://github.com/OWNER/Repo.git/"), "https://github.com/owner/repo");
  for (const url of ["http://github.com/a/b", "https://example.com/a/b", "https://github.com/a/b/tree/main", "https://github.com/a/b?x=1", "https://user:pass@github.com/a/b", "https://github.com/a/..", "https://github.com/a/b%2fc"]) {
    assert.throws(() => normalizeRepositoryUrl(url), /GitHub repository URL/);
  }
});

test("downloads the exact resolved commit without auth and parses the extracted archive", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-fetch-test-"));
  try {
    await mkdir(path.join(root, "source", "repo"), { recursive: true });
    await writeFile(path.join(root, "source", "repo", "main.ts"), 'export { value } from "./leaf";');
    await writeFile(path.join(root, "source", "repo", "leaf.ts"), "export const value = 1;");
    await run("tar", ["-czf", path.join(root, "fixture.tar.gz"), "-C", path.join(root, "source"), "repo"]);
    const archive = await readFile(path.join(root, "fixture.tar.gz"));
    const urls: string[] = [];
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      urls.push(String(input));
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return urls.length === 1 ? Response.json({ sha }) : new Response(new Uint8Array(archive));
    });
    const destination = path.join(root, "download");
    assert.equal(await fetchRepository("https://github.com/owner/repo", destination), sha);
    const result = await parseRepository(path.join(destination, "repo"));
    assert.equal(result.files.length, 2);
    assert.deepEqual(result.edges, [{ from: "main.ts", to: "leaf.ts", kind: "re-export" }]);
    assert.deepEqual(urls, ["https://api.github.com/repos/owner/repo/commits/HEAD", `https://codeload.github.com/owner/repo/tar.gz/${sha}`]);

    urls.length = 0;
    const fixture = databaseFixture();
    assert.deepEqual(await analyseRepository(fixture.db, "https://github.com/owner/repo"), { id: "test-analysis", status: "complete", created: true, started_at: startedAt });
    assert.deepEqual(fixture.updates.map(update => update.stage), ["select", "parse", "store"]);
    assert.equal(fixture.updates[0]?.commit_sha, sha);
    assert.deepEqual(fixture.results, [{ p_analysis_id: "test-analysis", p_started_at: startedAt, p_result: {
      files: result.files, edges: result.edges, imports: result.imports, coverage: result.coverage,
    } }]);

    urls.length = 0;
    const failedStorage = databaseFixture({ storeFails: true });
    await assert.rejects(analyseRepository(failedStorage.db, "https://github.com/owner/repo"), /failed during store.*storage refused/);
    assert.equal(failedStorage.failures[0]?.p_stage, "store");

    await writeFile(path.join(root, "source", "repo", "tsconfig.json"), '{"compilerOptions":{"moduleResolution":"invalid"}}');
    await run("tar", ["-czf", path.join(root, "invalid.tar.gz"), "-C", path.join(root, "source"), "repo"]);
    const invalidArchive = await readFile(path.join(root, "invalid.tar.gz"));
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? Response.json({ sha }) : new Response(new Uint8Array(invalidArchive)));
    const failedParsing = databaseFixture();
    await assert.rejects(analyseRepository(failedParsing.db, "https://github.com/owner/repo"), /failed during parse.*moduleResolution/);
    assert.equal(failedParsing.failures[0]?.p_stage, "parse");
    assert.equal(failedParsing.results.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reports missing repositories and invalid commit responses", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Not found", { status: 404 }));
  await assert.rejects(fetchRepository("https://github.com/owner/missing", "/unused"), /not found.*public/i);
  t.mock.method(globalThis, "fetch", async () => Response.json({ sha: "main" }));
  await assert.rejects(fetchRepository("https://github.com/owner/repo", "/unused"), /commit SHA/);
});

test("rejects an archive link escaping the extraction directory", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-unsafe-test-"));
  try {
    await mkdir(path.join(root, "source", "repo"), { recursive: true });
    await symlink("../../outside", path.join(root, "source", "repo", "tsconfig.json"));
    await run("tar", ["-czf", path.join(root, "fixture.tar.gz"), "-C", path.join(root, "source"), "repo"]);
    const archive = await readFile(path.join(root, "fixture.tar.gz"));
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? Response.json({ sha }) : new Response(new Uint8Array(archive)));
    await assert.rejects(fetchRepository("https://github.com/owner/repo", path.join(root, "download")), /outside|escapes/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("accepts an internal archive link when the workspace has a symlinked parent", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-linked-workspace-"));
  try {
    await mkdir(path.join(root, "source", "repo"), { recursive: true });
    await writeFile(path.join(root, "source", "repo", "main.ts"), "export const value = 1;");
    await symlink("main.ts", path.join(root, "source", "repo", "prisma-upgrade-v7"));
    await mkdir(path.join(root, "actual"));
    await symlink("actual", path.join(root, "alias"), "dir");
    await run("tar", ["-czf", path.join(root, "fixture.tar.gz"), "-C", path.join(root, "source"), "repo"]);
    const archive = await readFile(path.join(root, "fixture.tar.gz"));
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => ++calls === 1 ? Response.json({ sha }) : new Response(new Uint8Array(archive)));
    const destination = path.join(root, "alias", "download");
    assert.equal(await fetchRepository("https://github.com/owner/repo", destination), sha);
    assert.equal(await readFile(path.join(destination, "repo", "prisma-upgrade-v7"), "utf8"), "export const value = 1;");
  } finally { await rm(root, { recursive: true, force: true }); }
});
