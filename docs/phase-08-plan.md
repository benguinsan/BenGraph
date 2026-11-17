# Phase 08 implementation plan

Spec: `docs/specs/phase-08.md`. One framework per repository; root manifest
dependencies select Next.js → NestJS → React → generic. No packages added.

## Contracts

`lib/adapters/types.mts` defines `FrameworkFacts`:
`framework: "nextjs" | "nestjs" | "react" | null`,
`roles: { path: string; role: string }[]`,
`routes: { file: string; method: string; path: string }[]`.

`analyseFramework(root, sources)` accepts a repository root and readonly
`{ path: string; source: SourceFile }[]`, and returns `Promise<FrameworkFacts>`.
Only successfully parsed sources enter adapters. The parser retains its
existing module-format adapter argument and gains the framework facts in its
result. Framework names and rules stay outside parser core.

## Tasks

- [x] Adapter extraction: first write and run fixture tests for root manifest
  precedence, generic fallback, Next path conventions and exported HTTP handlers,
  Nest controller/method decorator literals and aliases, React roles, and routes
  that must be absent because their full method/path cannot be recovered.
  Implement `lib/adapters/index.mts` and focused framework modules with ts-morph;
  never evaluate source. Run `node --experimental-strip-types --test tests/framework.test.mts`.
- [x] Browser UI: browser-safe taxonomy with fixed concrete role order. Replace
  extension categories with framework categories when detected, retaining the
  generic extension view. Show framework, file roles, unidentified counts and a
  selectable route table in details. Preserve selection/filter/hover interactions.
  Extend the existing Node component harness; no browser automation.
- [x] Parser integration: include adapter facts only after syntax exclusions,
  validate their shape and endpoints on persisted reads, and serialize facts
  through the pipeline. Update existing parser/pipeline validation fixtures.
- [x] Persistence: add nullable analysis framework metadata; save `file_roles`
  and `routes` using their existing tables in the same replacement transaction.
  Use invoker functions and organization/parent policies. Legacy results remain
  readable without claiming prior detection; re-analysis produces new facts.
  Use the server-generated MCP migration version and generate types from the actual schema.
  Test transactional replacement, malformed endpoints and cross-organization reads.
- [x] Verify integration and review all changes. Run relevant Node tests,
  TypeScript, lint and production build. Report browser acceptance as ready for
  the user; do not execute the browser acceptance check or commit a phase early.

## Verification

120 Node tests, TypeScript, ESLint and production build passed.
Framework storage assertions passed on Supabase with transaction rollback,
including cross-organization read/write refusal and failed replacement recovery.
Migration `20261110195407_framework_adapters` is applied; generated types match.
Parsing this repository detects Next.js and extracts four page routes.
Browser acceptance remains manual; existing analyses require Re-analyse.
