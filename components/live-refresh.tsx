"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { subscribeToProgress } from "@/lib/realtime.mts";
import { useAuthenticatedSupabase } from "@/lib/supabase-browser";

export function LiveRefresh({ topic }: { topic: string }) {
  const db = useAuthenticatedSupabase();
  const router = useRouter();
  useEffect(() => subscribeToProgress(db, topic, {
    onProgress: () => router.refresh(), onSubscribed: () => router.refresh(),
    onError: error => { if (error) console.warn(error); },
  }), [db, topic, router]);
  return null;
}
