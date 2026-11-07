# Continuous integration

## Behaviour

- Run on pushes to `main` and `development`, and pull requests targeting either branch.
- Use Node.js 22 and the pnpm version declared in the project, with a cached package store and a frozen lockfile install.
- Run lint, the existing parser and graph tests, route type generation, TypeScript checking, and a production build. Any failed command fails the run.
- Cancel an older run when the same pull request or branch receives another push.
- Give the workflow read-only repository access. Build with explicitly fake environment values; no real Clerk or Supabase credentials are required. This checks compilation and prerendering, not live service integration.
- Do not deploy, change database state, or automate browser acceptance checks.

## Acceptance check

1. Push to `development` and open the CI run in GitHub Actions. Install, lint, tests, types, and build finish successfully.
2. Open a pull request targeting `main` or `development`; CI appears as a pull request check.
3. Introduce a failing assertion on a temporary branch; its pull request check fails at tests.
4. Push again while a run is active; the previous run for that branch or pull request is cancelled.
