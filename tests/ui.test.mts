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
import { previewAnalysis } from "../data/preview-analysis.mts";
import type { DetailPane } from "../components/detail-pane.tsx";
import type { InsightsPanel } from "../components/insights-panel.tsx";
import type { ThemeControl } from "../components/theme-control.tsx";

const hooks = {
  useState: (initial: unknown) => [initial, () => {}],
  useId: () => "details",
  useLayoutEffect: (effect: () => void) => effect(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
};

// Node cannot load TSX directly; evaluate the real components with explicit hook snapshots, without a browser.
function loadComponent(name: string, imports: Record<string, unknown> = {}, globals: Record<string, unknown> = {}) {
  const exported: { DetailPane?: typeof DetailPane; InsightsPanel?: typeof InsightsPanel; ThemeControl?: typeof ThemeControl } = {};
  const modules: Record<string, unknown> = {
    react: hooks, "react/jsx-runtime": jsxRuntime,
    "@/lib/graph/analysis.mts": graph, "@/lib/graph/folding.mts": folding,
    "@/lib/theme": { THEME_KEY: "theme" },
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

test("deselecting shows the repository summary while retaining Explanation for the next file", () => {
  const components = loadComponent("detail-pane", {
    react: { ...hooks, useState: (initial: unknown) => [initial === "structure" ? "explanation" : initial, () => {}] },
    "./insights-panel": loadComponent("insights-panel"),
  });
  assert.ok(components.DetailPane);
  const props = {
    analysis: previewAnalysis, name: "Excalidraw", modules: [],
    structure: repositoryStructure(previewAnalysis.files, previewAnalysis.edges),
    insights: graph.repositoryInsights(previewAnalysis.files, previewAnalysis.edges),
    selection: null, hovered: null, onHover() {}, onSelectFile() {},
  };
  const summary = renderToStaticMarkup(components.DetailPane(props));
  assert.ok(summary.includes("Most depended on"));
  assert.ok(!summary.includes("No explanation yet."));
  assert.ok(!summary.includes('role="tablist"'));
  const selected = renderToStaticMarkup(components.DetailPane({ ...props, selection: { kind: "file", id: previewAnalysis.files[0].path } }));
  assert.ok(selected.includes("No explanation yet."));
});

test("theme mount and clicks still work when storage reads and writes throw", () => {
  const document = { documentElement: { dataset: { theme: "dark" } } };
  const blocked = () => { throw new Error("Storage blocked"); };
  const components = loadComponent("theme-control", {}, { document, localStorage: { getItem: blocked, setItem: blocked } });
  assert.ok(components.ThemeControl);
  const control: ReactNode = components.ThemeControl();
  assert.equal(document.documentElement.dataset.theme, "system");
  assert.ok(isValidElement<{ children: ReactNode }>(control));
  const dark = Children.toArray(control.props.children).find(child => isValidElement<{ "aria-label": string }>(child) && child.props["aria-label"] === "Dark");
  assert.ok(isValidElement<{ onClick: () => void }>(dark));
  dark.props.onClick();
  assert.equal(document.documentElement.dataset.theme, "dark");
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
