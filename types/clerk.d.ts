// Claims added to the Clerk session token in the instance config (session.claims).
// `org_name` lets the server render the active organization from the token alone.
// `role: "authenticated"` is there for Supabase and isn't read by app code.
export {};

declare global {
  interface CustomJwtSessionClaims {
    org_name?: string;
  }
}
