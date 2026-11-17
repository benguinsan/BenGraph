# Standalone parser (Phase 03)

Requires Node 22.18 or later and installed project dependencies.

```sh
pnpm parse:repo /path/to/repository --out /tmp/analysis.json
node --experimental-strip-types --test tests/parser.test.mts
```

`parseRepository(directory, adapter?, onSelected?)` returns `ParseResult` from
`lib/parser/index.mts`. `readParseResult(filename)` reads and validates the
version 1 JSON shape. The optional async callback runs after file selection and
before parsing, so callers can record progress without database imports in the
parser. The parser does not clone repositories or access the network.

Phase 08 adds `framework`, `roles` and `routes`. Framework detection lives in
`lib/adapters/`: dependencies, dev, peer and optional dependencies in
the root `package.json` select one adapter, in Next.js → NestJS → React order.
Missing/unmatched manifests yield `framework: null` with no roles or routes;
invalid manifests fail explicitly. Nested package manifests do not independently
select frameworks. No dependency installation or repository code execution occurs.
Adapters inspect only successfully parsed files. Role memberships may overlap;
unmatched files remain unidentified. Routes are emitted only from recoverable
static conventions and syntax; computed or unsupported path modifiers are omitted.
The Next.js taxonomy also recognises loading/error/fallback UI, middleware/proxy,
dedicated metadata source files, instrumentation and conventional tests. Metadata
exported by a page/layout does not make that file a dedicated metadata file.
Only parsed source contributes: static metadata images, JSON and XML are excluded.
If any non-declaration source was skipped, routes are withheld because the
missing source could contain routing configuration; parsed roles remain visible.
Nest routes are also withheld when multiple Nest HTTP applications are detected:
controller ownership is not tracked, so one application's prefix cannot safely
be applied to every controller. File roles remain available.

Paths and folders are relative to the input directory, with `/` separators.
The root folder is `""`. Files carry line counts, SHA-256 hashes, module format
and distinct incoming/outgoing file counts. Edges are unique per source, target
and import kind; degrees count each source/target pair once across kinds.

Selection keeps all JS/TS source files in whole directories. `.git`,
`node_modules`, `.next`, `dist`, `build` and `coverage` directories are excluded.
Symbolic links are not followed. `filesFound` counts source candidates in the
selected directories; `filesParsed + filesSkipped` equals `filesFound`.
Source-file symbolic links, declarations, unreadable files and syntax failures
are listed with skip reasons. Directory links are not traversed.
No edges are emitted to skipped files.

Resolution uses the nearest `tsconfig.json` or `jsconfig.json` inside the input
directory, including inherited compiler options inside that directory. Config
reads outside the repository are refused, checking both lexical and real paths
for initial and inherited configs. Missing configs keep missing-file diagnostics;
other realpath failures are reported. Invalid configuration fails the
command. Imports and re-exports retain a record even when no edge can be emitted.
Both quoted strings and template literals without substitutions resolve as
static dynamic imports; computed expressions remain unresolved with a reason.
Dependencies that are not installed may remain unresolved, including workspace
packages. Their targets are never guessed. `require()` is outside Phase 03.
