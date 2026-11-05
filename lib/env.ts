// next.config.ts imports this file, so `next dev`, `next build` and `next start`
// all stop on boot naming the missing value, instead of failing three screens later.
// Server only: on the client, process.env[name] is empty and every read throws.
function read(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Add it to .env.local.`);
  return value;
}

export const env = {
  // Read by Clerk itself, checked here so a missing key fails at startup too.
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: read("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
  CLERK_SECRET_KEY: read("CLERK_SECRET_KEY"),
  // Without these Clerk sends people to its hosted pages instead of ours.
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: read("NEXT_PUBLIC_CLERK_SIGN_IN_URL"),
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: read("NEXT_PUBLIC_CLERK_SIGN_UP_URL"),
  NEXT_PUBLIC_SUPABASE_URL: read("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
};
