# Preview source

The fixture is the unmodified parser result for the **packages subtree** of
[Excalidraw](https://github.com/excalidraw/excalidraw), revision
[`701b901a0f1ba3d0b390d9cdf63d112e25abac4b`](https://github.com/excalidraw/excalidraw/tree/701b901a0f1ba3d0b390d9cdf63d112e25abac4b/packages)
(MIT licensed). Source directory: `packages`.

This includes the Excalidraw library and its internal packages, including their
tests. It does not include `excalidraw-app`, documentation, or repository-level
examples and scripts. Parsing the whole repository requires
`@tsconfig/docusaurus` for the documentation config; no dependency was installed
for this snapshot.

632 source files found, 621 parsed, 11 skipped (type declaration files).
The parsed files are 332 `.ts`, 288 `.tsx`, and one `.cjs`. The graph contains
3,489 resolved import edges; 4,748 import records comprise 3,954 resolved,
5 outside the selected root, 312 excluded, and 477 unresolved imports.
The packages' original TypeScript configs and path aliases are used unchanged.
External dependencies are not installed in the checkout; unresolved imports
retain their reasons rather than becoming guessed edges. The parser's `root`
field records the original temporary checkout path.

The fixture has real import cycles and files nothing imports, so both Insights
and dimming between file categories can be checked in the preview. A file with
no importers may be a test or an entry file; that does not mean it is unused.

To reproduce from the project root:

```sh
git clone https://github.com/excalidraw/excalidraw.git /tmp/cartograph-excalidraw
git -C /tmp/cartograph-excalidraw checkout 701b901a0f1ba3d0b390d9cdf63d112e25abac4b
pnpm parse:repo /tmp/cartograph-excalidraw/packages --out /tmp/cartograph-excalidraw-analysis.json
```

`preview-analysis.mts` adds only a type import and `export const
previewAnalysis: ParseResult =` before that JSON, followed by a semicolon.
No file, edge, metadata or coverage field is changed. A different checkout
directory changes the absolute `root` field.

The canvas derives its folders and file-extension counts from this fixture;
it neither reads a database nor reparses the source at runtime.
