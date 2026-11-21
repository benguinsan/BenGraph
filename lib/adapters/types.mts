export type Framework = "nextjs" | "nestjs" | "express" | "react" | null;
export interface FileRole { path: string; role: string }
export interface ExtractedRoute { file: string; method: string; path: string }
export interface FrameworkFacts {
  framework: Framework;
  roles: FileRole[];
  routes: ExtractedRoute[];
}

/** Rejects persisted framework facts that name missing files or duplicate entries. */
export function isFrameworkFacts(value: unknown, paths: ReadonlySet<string>): value is FrameworkFacts {
  if (typeof value !== "object" || value === null || !("framework" in value) ||
      (value.framework !== null && value.framework !== "nextjs" && value.framework !== "nestjs" && value.framework !== "express" && value.framework !== "react") ||
      !("roles" in value) || !Array.isArray(value.roles) || !("routes" in value) || !Array.isArray(value.routes)) return false;
  if (value.framework === null && (value.roles.length > 0 || value.routes.length > 0)) return false;
  const roles = new Set<string>();
  const roleItems: readonly unknown[] = value.roles;
  for (const item of roleItems) {
    if (typeof item !== "object" || item === null || !("path" in item) || typeof item.path !== "string" ||
        !paths.has(item.path) || !("role" in item) || typeof item.role !== "string" || !item.role.trim()) return false;
    const key = JSON.stringify([item.path, item.role]);
    if (roles.has(key)) return false;
    roles.add(key);
  }
  const routes = new Set<string>();
  const routeItems: readonly unknown[] = value.routes;
  for (const item of routeItems) {
    if (typeof item !== "object" || item === null || !("file" in item) || typeof item.file !== "string" ||
        !paths.has(item.file) || !("method" in item) || typeof item.method !== "string" ||
        !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(item.method) ||
        !("path" in item) || typeof item.path !== "string" || !item.path.startsWith("/")) return false;
    const key = JSON.stringify([item.file, item.method, item.path]);
    if (routes.has(key)) return false;
    routes.add(key);
  }
  return true;
}
