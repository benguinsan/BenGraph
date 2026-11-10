import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/types/database";
import { createRunToken } from "@/lib/run-token.mts";

// The one way this app reaches Postgres. Every request carries the caller's Clerk
// session token, so row-level security reads their organization off the claims.
// There is no anonymous fallback on purpose: a client without the token works
// until the first policy exists, then quietly returns nothing.
// The token is read here, inside the render, rather than lazily in accessToken:
// supabase-js calls accessToken from its realtime setup outside the render, where
// Next's prerender has already rejected headers(). One client per request.
export async function createSupabaseClient() {
  const token = await (await auth()).getToken();
  if (!token) throw new Error("No signed-in session, refusing to query Supabase anonymously.");
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    accessToken: async () => token,
  });
}

// Run-only renewal is the agreed exception to provider-free request reads.
export async function createRunSupabaseClient() {
  const { sessionId, userId, orgId, getToken } = await auth();
  if (!sessionId || !userId || !orgId) throw new Error("A signed-in session and active organization are required for a run.");
  const token = await getToken();
  if (!token) throw new Error("No signed-in session for this run.");
  const accessToken = createRunToken(token, { sessionId, userId, orgId }, () => getToken({ expiresInSeconds: 60 }));
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { accessToken });
}
