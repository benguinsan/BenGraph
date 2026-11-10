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
inheritance outside the repository is refused. Invalid configuration fails the
command. Imports and re-exports retain a record even when no edge can be emitted.
Both quoted strings and template literals without substitutions resolve as
static dynamic imports; computed expressions remain unresolved with a reason.
Dependencies that are not installed may remain unresolved, including workspace
packages. Their targets are never guessed. `require()` is outside Phase 03.
