# Phase 04 canvas implementation plan

**Goal:** Put the parser's real output in the existing three-column preview.
**Spec:** `docs/specs/phase-04.md`; categories are file extensions, as approved.
**Architecture:** Pure folding and projection over the parser contract; dagre
positions folder objects; React Flow renders folders and their bounded file rows.

- [x] Generate a typed, unchanged parser fixture from a pinned real source tree.
      Record its source, revision, coverage and reproduction command.
- [x] Add terminal tests in `tests/graph.test.mts` for deepest-first folding,
      fresh threshold passes, endpoint preservation, unique labels, selection,
      deterministic layout and fan-in sizing. Use Node's existing test runner.
- [x] Implement pure graph calculations in `lib/graph/` and connect them to a
      custom folder node in `components/dependency-map.tsx`.
- [x] Populate extension counts in `app/preview/page.tsx`; retain the empty
      right pane. Opening and closing use buttons; files are selectable rows.
      Bound the file list height, allow scrolling through all rows, and clamp
      off-screen file endpoints to the list boundaries.
- [x] Refit only after the new dimensions and handles are committed, using
      the current zoom as the maximum. No automatic movement otherwise.
- [x] Run terminal tests, types, lint, build and report the fixture's node,
      file and edge counts. Leave browser acceptance to the user.

No pushes, extra packages, database work or later-phase features.
