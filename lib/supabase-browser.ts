"use client";

import { useAuth } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import type { Database } from "@/types/database";

/** Clerk owns token renewal; Realtime asks this callback for a fresh token on heartbeat. */
export function useAuthenticatedSupabase() {
  const { getToken, isLoaded, isSignedIn, sessionId, orgId } = useAuth();
  return useMemo(() => {
    // Client components also render on the server, before browser auth is ready.
    if (typeof window === "undefined" || !isLoaded || !isSignedIn || !sessionId || !orgId) return null;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Supabase URL and publishable key are required.");
    return createClient<Database>(url, key, {
      accessToken: async () => {
        const token = await getToken();
        if (!token) throw new Error("No signed-in session for live progress.");
        return token;
      },
    });
  }, [getToken, isLoaded, isSignedIn, sessionId, orgId]);
}
