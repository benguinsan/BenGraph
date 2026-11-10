import { createClient } from "@supabase/supabase-js";
import { analyseRepository } from "../lib/pipeline/index.mts";
import type { Database } from "../types/database.ts";

const [url, ...extra] = process.argv.slice(2);
if (!url || extra.length) {
  console.error("Usage: pnpm analyse:repo https://github.com/owner/repo");
  process.exitCode = 1;
} else {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const token = process.env.CARTOGRAPH_ACCESS_TOKEN;
    if (!supabaseUrl || !key || !token) {
      throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local, and supply CARTOGRAPH_ACCESS_TOKEN as an environment variable (a Clerk session token with an active organization). Do not use a service-role key.");
    }
    let claims: unknown;
    try {
      const parts = token.split(".");
      if (parts.length !== 3) throw new Error("Invalid JWT");
      claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch { throw new Error("Invalid CARTOGRAPH_ACCESS_TOKEN: expected a JWT with a JSON payload."); }
    if (typeof claims !== "object" || claims === null || !("exp" in claims) ||
        typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= 0) {
      throw new Error("CARTOGRAPH_ACCESS_TOKEN must include an exp claim containing a positive finite number of seconds since the Unix epoch.");
    }
    const remaining = claims.exp - Date.now() / 1000;
    if (remaining <= 0) throw new Error("CARTOGRAPH_ACCESS_TOKEN has expired. Supply a fresh Clerk session token.");
    console.warn(`Warning: token expires in ${Math.ceil(remaining)}s; the CLI cannot renew it, so its remaining lifetime may limit the run.`);
    const db = createClient<Database>(supabaseUrl, key, { accessToken: async () => token });
    const result = await analyseRepository(db, url);
    console.log(`${result.created ? "Created" : "Existing"} analysis ${result.id}: ${result.status}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
