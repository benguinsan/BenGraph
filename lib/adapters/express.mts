import type { FrameworkFacts } from './types.mts';
import type { ParsedSource } from './syntax.mts';

const folders = new Map([
  ['route','route'], ['routes','route'], ['router','route'], ['routers','route'],
  ['controller','controller'], ['controllers','controller'],
  ['model','model'], ['models','model'],
  ['middleware','middleware'], ['middlewares','middleware'],
  ['service','service'], ['services','service'],
  ['config','config'], ['configs','config'],
]);

/** Roles come from the nearest conventional folder. Routes stay empty: Express assembles them at runtime. */
export function expressFacts(sources: readonly ParsedSource[]): FrameworkFacts {
  const roles: FrameworkFacts['roles'] = [];
  for (const {path} of sources) {
    const role = path.split('/').slice(0, -1).reverse().map(segment => folders.get(segment.toLowerCase())).find(Boolean);
    if (role) roles.push({path, role});
    if (/(?:^|\/)[^/]+\.config\.[cm]?[jt]s$/.test(path)) roles.push({path, role:'config'});
  }
  return {framework:'express', roles, routes:[]};
}
