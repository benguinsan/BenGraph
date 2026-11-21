import { readRootFile } from './files.mts';
import type { FrameworkFacts } from './types.mts';
import type { ParsedSource } from './syntax.mts';
import { nextFacts } from './next.mts';
import { nestFacts } from './nest.mts';
import { expressFacts } from './express.mts';
import { reactRoles } from './react.mts';

export async function analyseFramework(root: string, sources: readonly ParsedSource[]): Promise<FrameworkFacts> {
  const raw = await readRootFile(root, 'package.json');
  const manifest: unknown = raw === undefined ? {} : JSON.parse(raw);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Root package manifest must be an object');
  const dependencies = new Set<string>();
  for (const section of ['dependencies','devDependencies','peerDependencies','optionalDependencies']) {
    const entries: unknown = Reflect.get(manifest, section);
    if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
      for (const [name, version] of Object.entries(entries)) if (typeof version === 'string' && version.trim()) dependencies.add(name);
    }
  }
  let facts: FrameworkFacts;
  if (dependencies.has('next')) facts = await nextFacts(root, sources);
  else if (dependencies.has('@nestjs/core') || dependencies.has('@nestjs/common')) facts = nestFacts(sources);
  else if (dependencies.has('express')) facts = expressFacts(sources);
  else if (dependencies.has('react')) facts = {framework:'react', roles:reactRoles(sources), routes:[]};
  else facts = {framework:null, roles:[], routes:[]};
  facts.roles = [...new Map(facts.roles.map(role => [`${role.path}\0${role.role}`, role])).values()].sort((a,b) => a.path.localeCompare(b.path, 'en') || a.role.localeCompare(b.role, 'en'));
  facts.routes = [...new Map(facts.routes.map(route => [`${route.file}\0${route.method}\0${route.path}`, route])).values()].sort((a,b) => a.file.localeCompare(b.file, 'en') || a.method.localeCompare(b.method, 'en') || a.path.localeCompare(b.path, 'en'));
  return facts;
}
