# Preview source

The fixture is the unmodified parser result for the **compiler source subtree**
of [ts-morph](https://github.com/dsherret/ts-morph), revision
`f288183ddb496adc6f4c5b6929830b5b73437185` (MIT licensed).
Source directory: `packages/ts-morph/src/compiler`.

387 files found and parsed, 0 skipped; 1,301 resolved imports, 322 outside the
selected source root, 333 unresolved. The subtree has no compiler config, so
the parser uses its existing fallback. Workspace dependencies are not installed
in the source checkout; their unresolved imports are reported, never inferred.
The parser's `root` field records the original local checkout path.

To reproduce, check out that revision and run:

```sh
pnpm parse:repo /tmp/cartograph-ts-morph-phase04/packages/ts-morph/src/compiler --out /tmp/cartograph-phase04-analysis.json
```

`preview-analysis.mts` adds only a type import and `export const
previewAnalysis: ParseResult =` before that JSON, followed by a semicolon.
No file, edge, metadata or coverage field is changed.

The canvas derives its folders and file-extension counts from this fixture;
it neither reads a database nor reparses the source at runtime.
