import assert from "node:assert/strict";
import test from "node:test";
import { analysisProgress, isProgressUpdate, staleDeadline } from "../lib/progress.mts";

test("progress uses the recorded stage and reports the stage that failed", () => {
  const row = { status: "running", stage: "parse", message: "Resolving imports", error: null };
  assert.deepEqual(analysisProgress(row), { stage: "parse", message: "Resolving imports" });
  assert.deepEqual(analysisProgress({ ...row, status: "failed", error: "Invalid config" }), {
    stage: "failed", message: "Failed during parse: Invalid config",
  });
  assert.deepEqual(analysisProgress({ ...row, status: "complete", stage: "store", message: "Analysis complete" }), {
    stage: "complete", message: "Analysis complete",
  });
  assert.deepEqual(analysisProgress({ status: "queued", stage: null, message: null, error: null }), {
    stage: "queued", message: "Waiting to start",
  });
});

test("rejects malformed broadcast data instead of treating it as progress", () => {
  assert.ok(isProgressUpdate({ stage: "fetch", message: "Fetching archive" }));
  for (const value of [null, [], { stage: "parse" }, { stage: "invented", message: "" }, { stage: "store", message: 4 }]) {
    assert.equal(isProgressUpdate(value), false);
  }
});

test("staleness starts five minutes after run start, or creation for a queued run", () => {
  const created = "2026-11-09T10:00:00.000Z";
  const started = "2026-11-09T10:02:00.000Z";
  assert.equal(staleDeadline(created, started), Date.parse("2026-11-09T10:07:00.000Z"));
  assert.equal(staleDeadline(created, null), Date.parse("2026-11-09T10:05:00.000Z"));
});
