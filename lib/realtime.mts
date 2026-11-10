import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.ts";
import { isProgressUpdate, type ProgressUpdate } from "./progress.mts";

/** Recovers missed events after joining; an older snapshot cannot replace a newer broadcast. */
export function subscribeToProgress(db: SupabaseClient<Database>, topic: string, callbacks: {
  onProgress: (progress: ProgressUpdate) => void;
  onError: (error: string | null) => void;
  onSubscribed?: () => void;
  readSnapshot?: () => Promise<ProgressUpdate>;
}): () => void {
  let active = true;
  let revision = 0;
  let channel: RealtimeChannel | undefined;
  function fail(error: unknown) {
    if (active) callbacks.onError(`Live progress unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  void db.realtime.setAuth().then(() => {
    if (!active) return;
    channel = db.channel(topic, { config: { private: true } })
      .on("broadcast", { event: "progress" }, ({ payload }: { payload: unknown }) => {
        if (!active) return;
        if (!isProgressUpdate(payload)) { fail("Invalid progress message"); return; }
        revision++;
        callbacks.onError(null);
        callbacks.onProgress(payload);
      })
      .subscribe((status, error) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          callbacks.onError(null);
          callbacks.onSubscribed?.();
          const beforeRead = ++revision;
          void callbacks.readSnapshot?.().then(progress => {
            if (active && revision === beforeRead) callbacks.onProgress(progress);
          }).catch(error => { if (revision === beforeRead) fail(error); });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          fail(error ?? status);
        }
      });
  }).catch(fail);
  return () => {
    active = false;
    if (channel) void db.removeChannel(channel);
  };
}
