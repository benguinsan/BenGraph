# Cartograph

A dependency map built from parsing a public JavaScript or TypeScript GitHub
repository. Clerk owns sessions and organizations; Supabase policies isolate
stored analyses and private progress channels.

Requires Node 22.18+, pnpm and system tar. Configure the existing Clerk and
Supabase values in .env.local, apply all tracked database migrations, then run:

    pnpm dev

Open http://localhost:3000, submit a public repository URL and follow its
progress into the map. Duplicate submissions open the same analysis; use
**Re-analyse** there to deliberately fetch a newer commit.

Terminal checks:

    node --experimental-strip-types --test tests/*.test.mts
    pnpm exec next typegen
    pnpm exec tsc --noEmit
    pnpm lint
    pnpm build

See [pipeline and database setup](docs/pipeline.md), the
[standalone parser](docs/parser.md), and the [current phase spec](docs/specs/phase-07.md).
Browser acceptance is manual.
