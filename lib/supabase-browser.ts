"use client";

import { useAuth } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import type { Database } from "@/types/database";

/** Clerk owns token renewal; Realtime asks this callback for a fresh token on heartbeat. */
export function useAuthenticatedSupabase() {
  const { getToken, orgId } = useAuth();
  return useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Supabase URL and publishable key are required.");
    return createClient<Database>(url, key, {
      accessToken: async () => {
        if (!orgId) throw new Error("Choose an organization to receive live progress.");
        const token = await getToken();
        if (!token) throw new Error("No signed-in session for live progress.");
        return token;
      },
    });
  }, [getToken, orgId]);
}
