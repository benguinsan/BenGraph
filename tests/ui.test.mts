import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as graph from "../lib/graph/analysis.mts";
import * as folding from "../lib/graph/folding.mts";
import { repositoryStructure } from "../lib/graph/details.mts";
import { parseRepository } from "../lib/parser/index.mts";
import { testAnalysis } from "./fixtures/repository.mts";
import type { DetailPane } from "../components/detail-pane.tsx";
import type { InsightsPanel } from "../components/insights-panel.tsx";
import type { ThemeControl } from "../components/theme-control.tsx";
import type { AnalysisStatus } from "../components/analysis-status.tsx";
import type { CoverageBanner } from "../components/coverage-banner.tsx";
import type { AnalysisProgress } from "../components/analysis-progress.tsx";
import type { LiveRefresh } from "../components/live-refresh.tsx";
import * as coverage from "../lib/coverage.mts";
import * as progress from "../lib/progress.mts";

const theme: { THEME_KEY?: string; themeScript?: string } = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/theme.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: theme });

const hooks = {
  useState: (initial: unknown) => [initial, () => {}],
  useId: () => "details",
  useLayoutEffect: (effect: () => void) => effect(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
};

/** Evaluates real TSX components with explicit hook snapshots in Node, failing on missing dependencies instead of requiring a browser. */
function loadComponent(name: string, imports: Record<string, unknown> = {}, globals: Record<string, unknown> = {}) {
  const exported: { DetailPane?: typeof DetailPane; InsightsPanel?: typeof InsightsPanel; ThemeControl?: typeof ThemeControl; AnalysisStatus?: typeof AnalysisStatus; CoverageBanner?: typeof CoverageBanner; AnalysisProgress?: typeof AnalysisProgress; LiveRefresh?: typeof LiveRefresh } = {};
  const modules: Record<string, unknown> = {
    react: hooks, "react/jsx-runtime": jsxRuntime,
    "@/lib/graph/analysis.mts": graph, "@/lib/graph/folding.mts": folding,
    "@/lib/theme": theme,
    "@/lib/coverage.mts": coverage,
    ...imports,
  };
  const source = readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(compiled, {
    exports: exported,
    require(id: string) {
      if (!(id in modules)) throw new Error(`Missing test dependency: ${id}`);
      return modules[id];
    },
    ...globals,
  });
  return exported;
}

test("background live refresh stays invisible after connection errors and still refreshes on updates", () => {
  let error: string | null = null;
  let refreshes = 0;
  let receive: { onProgress: () => void; onSubscribed: () => void; onError: (error: string | null) => void } | undefined;
  const components = loadComponent("live-refresh", {
    react: {
      useState: () => [error, (value: string | null) => { error = value; }],
      useEffect: (effect: () => void) => effect(),
    },
    "next/navigation": { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    "@/lib/supabase-browser": { useAuthenticatedSupabase: () => ({}) },
    "@/lib/realtime.mts": {
      subscribeToProgress: (_db: unknown, _topic: string, callbacks: NonNullable<typeof receive>) => {
        receive = callbacks;
        return () => {};
      },
    },
  }, { console: { warn() {} } });
  assert.ok(components.LiveRefresh);
  assert.equal(components.LiveRefresh({ topic: "analysis:test" }), null);
  assert.ok(receive);
  receive.onError("Live progress unavailable: CLOSED");
  assert.equal(components.LiveRefresh({ topic: "analysis:test" }), null);
  receive.onSubscribed();
  receive.onProgress();
  assert.equal(refreshes, 2);
});

test("opens the stored map automatically after completion, never while storing or after failure", () => {
  const destinations: string[] = [];
  let refreshes = 0;
  let receive: ((update: progress.ProgressUpdate) => void) | undefined;
  const components = loadComponent("analysis-progress", {
    react: { ...hooks, useEffect: (effect: () => void) => effect() },
    "next/navigation": { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    "@/app/(app)/actions": { readProgress: async () => ({ stage: "complete", message: "Analysis complete" }) },
    "@/lib/progress.mts": progress,
    "@/lib/realtime.mts": {
      subscribeToProgress: (_db: unknown, _topic: string, callbacks: { onProgress: (update: progress.ProgressUpdate) => void }) => {
        receive = callbacks.onProgress;
        return () => {};
      },
    },
    "@/lib/supabase-browser": { useAuthenticatedSupabase: () => ({}) },
    "./analysis-status": loadComponent("analysis-status"),
  }, { window: { location: { replace: (url: string) => destinations.push(url) } } });
  assert.ok(components.AnalysisProgress);
  components.AnalysisProgress({ id: "new-analysis", initial: { stage: "parse", message: "Parsing" }, deadline: 0 });
  assert.ok(receive);
  receive({ stage: "store", message: "Storing files, edges and coverage" });
  assert.deepEqual(destinations, []);
  receive({ stage: "failed", message: "Could not store graph" });
  assert.deepEqual(destinations, []);
  assert.equal(refreshes, 1);
  receive({ stage: "complete", message: "Analysis complete" });
  assert.deepEqual(destinations, ["/analyses/new-analysis"]);
});

test("collapsed coverage summary keeps the partial figure and parsed file count", () => {
  const components = loadComponent("coverage-banner");
  assert.ok(components.CoverageBanner);
  const analysis = { ...testAnalysis,
    imports: [...testAnalysis.imports, { from: "core/a.ts", specifier: "./missing", kind: "import" as const, status: "unresolved" as const, reason: "File not found" }],
    coverage: { ...testAnalysis.coverage, filesFound: 9, filesSkipped: 1, skipped: [{ path: "broken.ts", reason: "Syntax error" }],
      importsSeen: 8, importsUnresolved: 1 },
  };
  const markup = renderToStaticMarkup(components.CoverageBanner({ analysis }));
  const summary = markup.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1];
  assert.ok(summary?.includes("Partial graph"));
  assert.ok(summary?.includes("87.5%"));
  assert.ok(summary?.includes("8/9 files parsed"));
  assert.ok(markup.includes("File not found"));
  assert.ok(markup.includes("Syntax error"));
});

test("unfinished runs become stale using one local timer; completion clears the stale badge", () => {
  const now = Date.parse("2026-11-09T10:00:00Z");
  const deadline = now + 300_000;
  let expired: number | null = null;
  const timers: { callback: () => void; delay: number }[] = [];
  const components = loadComponent("analysis-status", {
    react: {
      useState: () => [expired, (value: number) => { expired = value; }],
      useEffect: (effect: () => void) => effect(),
    },
  }, {
    Date: { now: () => now },
    setTimeout: (callback: () => void, delay: number) => { timers.push({ callback, delay }); return 1; },
    clearTimeout() {},
  });
  assert.ok(components.AnalysisStatus);
  const props = { status: "running", stage: "parse", deadline };
  assert.ok(!renderToStaticMarkup(components.AnalysisStatus(props)).includes("stale ·"));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 300_000);
  timers[0].callback();
  assert.ok(renderToStaticMarkup(components.AnalysisStatus(props)).includes("stale · parse"));
  assert.ok(!renderToStaticMarkup(components.AnalysisStatus({ ...props, status: "complete" })).includes("stale ·"));
});

/** Finds an accessible theme button in the rendered control and invokes its actual selection handler. */
function clickTheme(control: ReactNode, label: string) {
  assert.ok(isValidElement<{ children: ReactNode }>(control));
  const button = Children.toArray(control.props.children).find(child => isValidElement<{ "aria-label": string }>(child) && child.props["aria-label"] === label);
  assert.ok(isValidElement<{ onClick: () => void }>(button));
  button.props.onClick();
}

/** Keeps storage values across simulated page reloads while supplying the browser methods used by theme persistence. */
function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("deselecting shows the repository summary while retaining Explanation for the next file", () => {
  const components = loadComponent("detail-pane", {
    react: { ...hooks, useState: (initial: unknown) => [initial === "structure" ? "explanation" : initial, () => {}] },
    "./insights-panel": loadComponent("insights-panel"),
  });
  assert.ok(components.DetailPane);
  const props = {
    analysis: testAnalysis, name: "Fixture repository", modules: [],
    structure: repositoryStructure(testAnalysis.files, testAnalysis.edges),
    insights: graph.repositoryInsights(testAnalysis.files, testAnalysis.edges),
    selection: null, hovered: null, onHover() {}, onSelectFile() {},
  };
  const summary = renderToStaticMarkup(components.DetailPane(props));
  assert.ok(summary.includes("Most depended on"));
  assert.ok(!summary.includes("No explanation yet."));
  assert.ok(!summary.includes('role="tablist"'));
  const selected = renderToStaticMarkup(components.DetailPane({ ...props, selection: { kind: "file", id: testAnalysis.files[0].path } }));
  assert.ok(selected.includes("No explanation yet."));
});

test("theme mount and clicks still work when storage reads and writes throw", () => {
  const document = { documentElement: { dataset: { theme: "dark" } } };
  const blocked = () => { throw new Error("Storage blocked"); };
  const components = loadComponent("theme-control", {}, {
    document, localStorage: { getItem: blocked, setItem: blocked },
    sessionStorage: { getItem: blocked, setItem: blocked, removeItem: blocked },
  });
  assert.ok(components.ThemeControl);
  const control: ReactNode = components.ThemeControl();
  assert.equal(document.documentElement.dataset.theme, "system");
  clickTheme(control, "Dark");
  assert.equal(document.documentElement.dataset.theme, "dark");
});

test("failed theme writes survive reload and override old localStorage values or the default", () => {
  assert.ok(theme.themeScript);
  for (const entry of [
    { old: "light", label: "Dark", expected: "dark" },
    { old: "dark", label: "Match system", expected: "system" },
    { old: null, label: "Light", expected: "light" },
  ]) {
    const localStorage = {
      getItem: () => entry.old,
      setItem: () => { throw new Error("Quota exceeded"); },
    };
    const sessionStorage = storage();
    const document = { documentElement: { dataset: { theme: "system" } } };
    const components = loadComponent("theme-control", {}, { document, localStorage, sessionStorage });
    assert.ok(components.ThemeControl);
    clickTheme(components.ThemeControl(), entry.label);
    assert.equal(document.documentElement.dataset.theme, entry.expected);

    const reloaded = { documentElement: { dataset: { theme: "system" } } };
    vm.runInNewContext(theme.themeScript, { document: reloaded, localStorage, sessionStorage });
    assert.equal(reloaded.documentElement.dataset.theme, entry.expected, "head script reads the newest choice");
    const mounted = loadComponent("theme-control", {}, { document: reloaded, localStorage, sessionStorage });
    assert.ok(mounted.ThemeControl);
    mounted.ThemeControl();
    assert.equal(reloaded.documentElement.dataset.theme, entry.expected, "mount retains the fallback choice");
  }
});

test("a later successful localStorage write replaces an older session fallback", () => {
  assert.ok(theme.themeScript);
  const localStorage = storage({ theme: "light" });
  const sessionStorage = storage({ theme: "dark" });
  const document = { documentElement: { dataset: { theme: "system" } } };
  const components = loadComponent("theme-control", {}, { document, localStorage, sessionStorage });
  assert.ok(components.ThemeControl);
  const control = components.ThemeControl();
  assert.equal(document.documentElement.dataset.theme, "dark");
  clickTheme(control, "Match system");
  assert.equal(localStorage.getItem("theme"), "system");
  const reloaded = { documentElement: { dataset: { theme: "light" } } };
  vm.runInNewContext(theme.themeScript, { document: reloaded, localStorage, sessionStorage });
  assert.equal(reloaded.documentElement.dataset.theme, "system");
});

test("cycle summary renders the shared selectable file path", () => {
  const components = loadComponent("insights-panel", { react: { ...hooks, useState: () => [true, () => {}] } });
  assert.ok(components.InsightsPanel);
  const markup = renderToStaticMarkup(components.InsightsPanel({
    insights: { unimported: [], highFanIn: [], longFiles: [], cycles: [["a.ts", "b.ts", "a.ts"]] },
    renderPath: path => createElement("button", { type: "button", "aria-label": `Select ${path}` }, path),
  }));
  assert.match(markup, /<summary[^>]*>(?:(?!<\/summary>)[\s\S])*<button[^>]*aria-label="Select a.ts"/);
});

test("walk results group shortest steps and count further reachable files in both directions", async () => {
  const root = await mkdtemp(join(tmpdir(), "cartograph-steps-"));
  try {
    const sources = {
      "a.ts": 'import "./b"; import "./c";',
      "b.ts": 'import "./d";',
      "c.ts": 'import "./d";',
      "d.ts": 'import "./e";',
      "e.ts": 'import "./a";',
      "alone.ts": 'export {};',
    };
    await Promise.all(Object.entries(sources).map(([path, source]) => writeFile(join(root, path), source)));
    const analysis = await parseRepository(root);
    for (const direction of ["dependents", "dependencies"] as const) {
      const components = loadComponent("detail-pane", {
        react: { ...hooks, useState: (initial: unknown) => [initial === null ? { path: "a.ts", direction } : initial, () => {}] },
        "./insights-panel": loadComponent("insights-panel"),
      });
      assert.ok(components.DetailPane);
      const markup = renderToStaticMarkup(components.DetailPane({
        analysis, name: "Steps", modules: [], structure: repositoryStructure(analysis.files, analysis.edges),
        insights: graph.repositoryInsights(analysis.files, analysis.edges),
        selection: { kind: "file", id: "a.ts" }, hovered: null, onHover() {}, onSelectFile() {},
      }));
      const title = direction === "dependents" ? "Blast radius" : "Dependency chain";
      const result = markup.match(new RegExp(`<section aria-label="${title}"[^>]*>([\\s\\S]*?)<\\/section>`))?.[1];
      assert.ok(result, `${title} results are labelled`);
      assert.ok(result.includes(`1 step away · ${direction === "dependents" ? 1 : 2}`));
      assert.ok(result.includes("2 steps away · 1"));
      assert.ok(result.indexOf("1 step away") < result.indexOf("2 steps away"));
      assert.ok(result.includes(`${direction === "dependents" ? 2 : 1} more further than 2 steps, not listed.`));
      const paths = [...result.matchAll(/aria-label="([^"]+\.ts)"/g)].map(match => match[1]);
      assert.deepEqual(paths, direction === "dependents" ? ["e.ts", "d.ts"] : ["b.ts", "c.ts", "d.ts"]);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
