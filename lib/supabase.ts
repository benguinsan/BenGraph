import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// The one way this app reaches Postgres. Every request carries the caller's Clerk
// session token, so row-level security reads their organization off the claims.
// There is no anonymous fallback on purpose: a client without the token works
// until the first policy exists, then quietly returns nothing.
export function createSupabaseClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    accessToken: async () => {
      const token = await (await auth()).getToken();
      if (!token) throw new Error("No signed-in session, refusing to query Supabase anonymously.");
      return token;
    },
  });
}
