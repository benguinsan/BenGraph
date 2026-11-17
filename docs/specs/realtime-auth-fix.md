# Realtime authentication and dependency fixes

## Behaviour

- Use patched Next.js and minimatch dependencies without excluding packages from
  the release-age check. A scoped minimatch pin is temporary until patched parent
  releases pass that check; verify parser and lint compatibility with the pin.
- Browser Realtime clients wait for Clerk to finish loading and provide a signed-in
  session with an active organization. Server rendering never initializes them.
- Both live refresh and analysis progress wait for a ready client. Signing out or
  switching sessions or organizations cleans up the previous subscription.
- Missing or failed session tokens remain visible authentication errors; never
  fall back to an anonymous subscription or weaken database policies.
- Keep development Clerk credentials for local development. Production deployment
  requires a production Clerk instance and its environment-specific credentials.

## Acceptance check

1. Open an analysis after signing in; there is no initial missing-organization
   Realtime warning and progress still updates automatically.
2. Switch organizations or sign out while viewing progress. The old subscription
   closes and cannot continue refreshing the previous view.
3. Interrupt a live connection; the existing error and manual-refresh behaviour
   remains available.

Terminal checks: regression tests, types, lint, build and dependency audit.
