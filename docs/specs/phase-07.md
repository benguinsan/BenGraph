# Phase 7 — The pipeline

**Goal.** Paste a URL and watch your own repository become a map.

## Build

- Fetching a public repository as an archive. No repository scope is requested
  and no token is ever stored.
- Record which commit the archive came from. A later phase needs to know
  whether the repository has moved on since.
- The run: fetch, select, parse, store — with named stages, and a catch at the
  top that writes a failed state rather than leaving a row stuck mid-parse
  forever.
- The form on the dashboard, finally wired to something.
- **One analysis per repository.** Submitting a URL that has already been
  analysed does not create a second one — it takes you to the existing analysis.
  Re-running the same repository is a deliberate act from that analysis, not
  something you get by pasting the URL again.
- A progress page that names the stage as it happens, updated live.
- The explorer, now reading real stored rows instead of the checked-in file.
- Background live-refresh connection errors on the dashboard and completed map
  go to the browser console, without a banner. The active analysis progress page
  keeps its visible connection warning and manual refresh action.
- A coverage banner on the map, which says the graph is partial when it is.

## Constraints

- Live progress is driven from the database, not from the browser polling.
  Something in the database publishes when the stage moves, and the page
  subscribes. Publish the stage and its message, not the whole row — then the
  page has nothing to filter and nothing to interpret.
- **Declare private topics through receive policies in the migration.** Use
  `analysis:<uuid>` for progress and organization-scoped topics for dashboard
  updates. Publish through `realtime.send()`; there is no separate channel registry.
- Publish from a trigger on our own table. Never attach a trigger to the
  realtime machinery itself.
- **Who may subscribe is also a policy.** Another organization's analysis
  channel is not subscribable, for the same reason its rows aren't selectable.
  The progress stream is protected the same way the data is.
- The browser side uses the authenticated client, not a bare one — it needs the
  access token cookie to open the socket, which is why that cookie is readable
  in the first place.
- Long runs may renew the initiating Clerk session token in the server auth
  layer, pinned to the original session, user and organization. This is the
  agreed exception to Phase 01's runtime identity-provider restriction.
- A run that fails writes _why_ it failed and which stage it failed in.
- **A run that dies without failing has to be visible too.** Nothing here has a
  queue or a timeout, so a process that stops mid-parse leaves a row that will
  say "parsing" forever. The dashboard marks any unfinished run past a few
  minutes old as stale, so the difference between working and abandoned is
  legible without opening it.
- The coverage banner may collapse, but it collapses to a single line that
  still names the figure. A graph that is quietly thirty percent complete must
  never be able to look complete.
- Coverage is `importsResolved / (importsSeen - importsOutside)`. No considered
  imports means 100%, with the zero denominator visible in the details. Mark
  **Partial graph** whenever an import is unresolved or excluded, or a file is
  skipped. The collapsed line retains the percentage and parsed/found file counts.
- **Delete the checked-in parser output and the preview route as part of this
  phase.** It was scaffolding to build the interface against; analyses are
  stored properly now. Everything built on it keeps working, on live data.

## Acceptance check

1. Paste a public repository URL. The stages tick past with real names, not a
   spinner, and land on its map.
2. Paste a repository you've already analysed. You land on the existing
   analysis. There is still one row for it, not two.
3. Paste a URL for a repository that doesn't exist. It fails with a message
   that says what went wrong, and the dashboard row reads failed — not
   "parsing" forever.
4. Open the dashboard in a second tab during a run. The stage updates there
   too, without a refresh.
5. Analyse a repository with a deliberately awkward setup — aliases, or a
   nested app — and confirm the coverage banner appears and names a figure
   under 95%.

## Not in this phase

Framework-specific roles, and routes.
