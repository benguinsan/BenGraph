import { clerkMiddleware } from "@clerk/nextjs/server";

// Everything except signing in and signing up needs a session. A signed-out
// visitor is redirected here, before rendering, so a protected page's HTML is
// never sent. Pages still call auth.protect() for themselves.
const openPaths = ["/sign-in", "/sign-up"];

export default clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;
  if (openPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return;
  await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
