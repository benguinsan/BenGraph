# Repository pipeline — Phase 07

Fetches a public GitHub archive at an exact commit, selects and parses source
files, then stores file facts, import edges, coverage and import reasons.
No repository code or install scripts are executed. No GitHub token is used.

Apply the tracked migrations before running it. The pipeline migration is
`supabase/migrations/20261110114308_repository_pipeline.sql`; progress is added by
`supabase/migrations/20261110114313_analysis_progress.sql`; stored reads and explicit
re-analysis are added by `supabase/migrations/20261110114317_stored_explorer_and_reanalysis.sql`.
The pipeline adds organization-scoped write policies and two invoker-rights functions:
`begin_analysis` claims a repository once per organization, and `store_analysis`
saves the graph and marks completion in one transaction. Start and finish times
come from Postgres. Existing duplicates
cause migration failure rather than being silently deleted.

## Run

Requires Node 22.18+, system `tar`, and the existing Supabase URL and publishable
key in `.env.local`. Supply a current Clerk session JWT with an active
organization as `CARTOGRAPH_ACCESS_TOKEN` in the process environment. It is used
only for authenticated database access; never use a service-role key or commit
the token.

The CLI validates that the JWT has a positive finite numeric `exp` claim and
has not expired before creating its database client. It warns how many seconds
remain: the CLI reuses this token and cannot renew it, so its remaining lifetime
may limit the run. Obtain a fresh token immediately before starting. If it
expires during analysis, storing results or recording failure may fail, leaving
the run stale. Use the app's renewable server-run path for longer analyses.
This local expiry check does not verify the signature; Supabase still does that.

```sh
pnpm analyse:repo https://github.com/owner/repository
```

The command prints the analysis ID and final status, or reports an error and
exits unsuccessfully. A duplicate URL returns the existing analysis, including
a running or failed one, without fetching again. Case, a trailing slash and
the `.git` suffix are normalized. Re-running is an explicit **Re-analyse** action
on that analysis page, never a side effect of submitting its URL again.

`analyseRepository(authenticatedClient, url)` is also callable from server code.
It records `fetch`, `select`, `parse` and `store` stages in the database. Selection
is the parser's existing directory walk; its optional third callback marks the
transition into parsing. Failures retain the stage, reason and finish time.
Temporary archives are removed on success and caught failures.

## Dashboard and progress

The dashboard form claims the analysis, schedules the newly claimed run with
Next's `after`, and navigates to `/analyses/<id>`. Existing analyses navigate to
the same page without starting another run. Completion navigates directly to
`/analyses/<id>`, loading the explorer from stored file and edge rows through a single aggregate
RPC. The commit displayed with the graph comes from that same snapshot. The
aggregate avoids the API's default list-row truncation, and results are validated
before rendering. Missing legacy parser data is shown as missing, with an explicit
re-analysis action; no demo graph is substituted.

There is no queue; an interrupted
process leaves an unfinished run, marked stale after five minutes using a local
timer. No database polling is involved.

Re-analysis retains the same analysis row and may start after completion, failure,
or staleness. A fresh active run refuses a second start. Every writer carries
the original run's `started_at` timestamp, so a process abandoned by a restart
cannot advance, complete or fail the newer run. The old file rows survive until
the replacement transaction succeeds; any failed save rolls back the deletion.

Long-running analyses may renew their initiating Clerk session token in the
server auth layer. This is the agreed exception to Phase 01's no-runtime-provider
rule; ordinary page reads still use the token supplied with the request. Renewed
tokens must match the original session, user and organization, and are cached
only until shortly before expiry. A changed scope is rejected. If the session
is revoked or renewal cannot preserve the organization, the run can lose write
access; its logged failure and eventual stale indicator remain the fallback.

A trigger on `public.analyses` publishes only `{stage, message}`; Supabase adds
its own transport `id`. Terminal stages
are `complete` and `failed`; a failure message includes the original run stage.
Private topic policies declare `analysis:<uuid>` for a single analysis and
`organization:<org-id>:analyses` for dashboard notifications. The analysis policy
uses the existing row policies, so another organization's channel is denied.
There is no separate channel registry and no client broadcast policy. The
publisher is a private trigger function, not an exposed definer-rights RPC.

Browser clients use Clerk's token callback, including token renewal, for the
socket. On subscription and reconnect, the progress page reads a server snapshot
once to recover missed events; a newer broadcast wins over an older snapshot.
The dashboard refreshes its server-rendered rows on events and reconnects.
Completed analysis pages also subscribe so they recover if another tab restarts
the analysis, including a restart between the metadata and graph reads.
Queries and authorization remain on the server and in database policies.

Realtime must be enabled in the Supabase project. Database broadcasts require
Realtime's daily message partition, created by a WebSocket connection; the
dashboard establishes that connection. Snapshot recovery also handles events
sent before a page subscribed. The progress page reports connection failures
instead of silently displaying a stuck stage.

Downloads are limited to 50 MiB compressed and 250 MiB of decompressed archive.
Unsafe archive paths and escaping links fail. Compiler config inheritance
outside the repository fails too. Dependencies are not installed: unresolved
imports remain reported with their real reasons.

## Coverage

Import coverage is `importsResolved / (importsSeen - importsOutside)`; zero known
imports are reported as 100% with an explicit zero denominator. The displayed
percentage is truncated to one decimal so a partial result never rounds up to
100%. The graph is labelled **Partial graph** if any file was skipped or any
import was excluded or unresolved, even when the percentage exceeds 95%.

The native collapsible banner always retains the percentage and parsed/found
file counts in its summary. Details name the import counts and the parser's
actual reasons for missing imports and skipped files. Only examples are capped;
the full counts stay visible. The explorer no longer has a preview route or a
checked-in parser result. Tests create and parse source fixtures at runtime.

## Terminal checks

```sh
node --experimental-strip-types --test tests/*.test.mts
```

For storage and policy assertions, run `tests/pipeline-storage.sql` with `psql`
against a disposable Postgres database containing all migrations, as its owner.
The script switches to `authenticated`, supplies test organization claims, and
rolls back its test rows. It checks duplicate reuse, atomic rollback, stored
parser facts and cross-organization denial. It requires Supabase's `auth.jwt()`
function and roles, or equivalent local test fixtures.

`tests/realtime-progress.sql` checks topic isolation, stage and terminal
broadcasts, minimal payloads and refusal of client publishing. It requires
Supabase's Realtime schema/functions or equivalent local SQL fixtures. These SQL
checks do not verify WebSocket transport; browser acceptance remains manual.

`tests/reanalysis.sql` checks atomic replacement, refusal of active restarts,
superseded writers, same-stage restart broadcasts, cross-organization reads and
restarts, and a stored result with 1,205 files.

## Hosted deployment

The application uses the publishable key and Clerk token, including all database
policies. Apply only migrations absent from the hosted migration history, in
order, through authenticated Supabase MCP or a Postgres administration connection.
Keep the recorded versions aligned with the tracked migration filenames. MCP
migration deployment needs no database password in the application's environment.
Never use a service-role key for application queries.

Until hosted migrations are applied, compilation and local database checks do
not establish that the hosted app is ready.

The browser acceptance check in `docs/specs/phase-07.md` remains the owner's to
run. Framework roles, routes and AI are outside this phase.
