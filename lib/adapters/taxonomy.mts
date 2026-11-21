import type { FileRole, Framework } from "./types.mts";
import type { ParsedFile } from "../parser/index.mts";
import { fileCategories } from "../graph/analysis.mts";

export const frameworkNames = { nextjs: "Next.js", nestjs: "NestJS", express: "Express", react: "React" };

const taxonomy = {
  nextjs: [["page", "Page routes"], ["api", "API endpoints"], ["server-action", "Server actions"], ["layout", "Layouts"], ["loading-error", "Loading & error UI"], ["component", "Components"], ["hook", "Hooks"], ["middleware", "Middleware"], ["metadata", "Metadata files"], ["instrumentation", "Instrumentation"], ["config", "Config files"], ["test", "Tests"]],
  nestjs: [["controller", "Controllers"], ["service", "Services"], ["module", "Modules"], ["entity", "Entities"], ["guard", "Guards"], ["middleware", "Middleware"], ["config", "Config"]],
  express: [["route", "Routers"], ["controller", "Controllers"], ["model", "Models"], ["middleware", "Middleware"], ["service", "Services"], ["config", "Config"]],
  react: [["component", "Components"], ["hook", "Hooks"], ["context", "Contexts"], ["config", "Config"]],
} as const;

export function roleLabel(framework: Framework, role: string) {
  return framework === null ? role : taxonomy[framework].find(([id]) => id === role)?.[1] ?? role;
}

/** Counts only real file memberships, retaining fixed framework reading order and empty categories. */
export function repositoryCategories(files: readonly ParsedFile[], framework: Framework, roles: readonly FileRole[]) {
  if (framework === null) return fileCategories(files);
  const categories = new Map<string, Set<string>>(taxonomy[framework].map(([, label]) => [label, new Set<string>()]));
  const paths = new Set(files.map(file => file.path));
  const identified = new Set<string>();
  for (const { path, role } of roles) {
    const category = categories.get(roleLabel(framework, role));
    if (!category || !paths.has(path)) continue;
    category.add(path);
    identified.add(path);
  }
  categories.set("Unidentified", new Set([...paths].filter(path => !identified.has(path))));
  return categories;
}
