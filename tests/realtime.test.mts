import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createClient, REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { subscribeToProgress } from "../lib/realtime.mts";
import type { ProgressUpdate } from "../lib/progress.mts";

test("authenticates a private channel, recovers snapshots and never overwrites a newer event", async (t) => {
  const db = createClient<Database>("https://database.example", "test-key");
  const channel = db.channel("analysis:test", { config: { private: true } });
  const updates: ProgressUpdate[] = [];
  const errors: (string | null)[] = [];
  const status: { callback?: Parameters<typeof channel.subscribe>[0] } = {};
  const auth = t.mock.method(db.realtime, "setAuth", async () => {});
  t.mock.method(db, "channel", (topic: Parameters<typeof db.channel>[0], options?: Parameters<typeof db.channel>[1]) => {
    assert.equal(auth.mock.callCount(), 1);
    assert.equal(topic, "analysis:test");
    assert.equal(options?.config?.private, true);
    return channel;
  });
  t.mock.method(channel, "subscribe", (callback: Parameters<typeof channel.subscribe>[0]) => { status.callback = callback; return channel; });
  const remove = t.mock.method(db, "removeChannel", async () => "ok" as const);
  let resolveSnapshot: (value: ProgressUpdate) => void = () => { throw new Error("No snapshot requested"); };
  const stop = subscribeToProgress(db, "analysis:test", {
    onProgress: progress => updates.push(progress), onError: error => errors.push(error),
    readSnapshot: () => new Promise(resolve => { resolveSnapshot = resolve; }),
  });
  await setImmediate();
  status.callback?.(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
  channel.bindings.broadcast[0].callback({ event: "progress", payload: { stage: "parse", message: "Parsing" } }, "", "");
  resolveSnapshot({ stage: "fetch", message: "Old snapshot" });
  await setImmediate();
  assert.deepEqual(updates, [{ stage: "parse", message: "Parsing" }]);

  status.callback?.(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error("Socket disconnected"));
  assert.equal(errors.at(-1), "Live progress unavailable: Socket disconnected");
  status.callback?.(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
  const olderRead = resolveSnapshot;
  status.callback?.(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR, new Error("Disconnected again"));
  status.callback?.(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
  resolveSnapshot({ stage: "store", message: "New reconnect snapshot" });
  await setImmediate();
  olderRead({ stage: "parse", message: "Old reconnect snapshot" });
  await setImmediate();
  assert.equal(updates.at(-1)?.stage, "store");
  status.callback?.(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
  resolveSnapshot({ stage: "complete", message: "Analysis complete" });
  await setImmediate();
  assert.equal(updates.at(-1)?.stage, "complete");
  stop();
  assert.equal(remove.mock.callCount(), 1);
  channel.bindings.broadcast[0].callback({ event: "progress", payload: { stage: "fetch", message: "After cleanup" } }, "", "");
  assert.equal(updates.at(-1)?.stage, "complete");
});

test("reports authentication failure without opening an anonymous channel", async (t) => {
  const db = createClient<Database>("https://database.example", "test-key");
  t.mock.method(db.realtime, "setAuth", async () => { throw new Error("No session"); });
  const errors: (string | null)[] = [];
  const stop = subscribeToProgress(db, "analysis:test", { onProgress() {}, onError: error => errors.push(error) });
  await setImmediate();
  assert.deepEqual(errors, ["Live progress unavailable: No session"]);
  assert.equal(db.getChannels().length, 0);
  stop();
});
