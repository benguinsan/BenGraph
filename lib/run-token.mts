interface RunIdentity { sessionId: string; userId: string; orgId: string }

function expiry(token: string, identity: RunIdentity): number {
  let claims: unknown;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT");
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch { throw new Error("Invalid run session token."); }
  if (typeof claims !== "object" || claims === null || !("exp" in claims) ||
      typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= 0) {
    throw new Error("Invalid run session token expiry.");
  }
  if (!("sid" in claims) || claims.sid !== identity.sessionId || !("sub" in claims) || claims.sub !== identity.userId ||
      !("o" in claims) || typeof claims.o !== "object" || claims.o === null || !("id" in claims.o) || claims.o.id !== identity.orgId) {
    throw new Error("Run token changed session, user or organization; refusing to change the run's scope.");
  }
  return claims.exp * 1000;
}

/** Scope-checks tokens received from Clerk; Supabase still verifies their signatures. */
export function createRunToken(initial: string, identity: RunIdentity, renew: () => Promise<string | null>): () => Promise<string> {
  let token = initial;
  let expiresAt = expiry(initial, identity);
  let refreshing: Promise<string> | undefined;
  return async () => {
    if (Date.now() < expiresAt - 5000) return token;
    refreshing ??= renew().then(renewed => {
      if (!renewed) throw new Error("No renewed session token for this run.");
      const renewedExpiry = expiry(renewed, identity);
      if (renewedExpiry <= Date.now()) throw new Error("Renewed run session token has expired.");
      token = renewed;
      expiresAt = renewedExpiry;
      return token;
    }).finally(() => { refreshing = undefined; });
    return refreshing;
  };
}
