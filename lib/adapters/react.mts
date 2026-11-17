import { Node, SyntaxKind } from 'ts-morph';
import type { FileRole } from './types.mts';
import { callable, exportsOf, hasJsx, importedName, type ParsedSource } from './syntax.mts';

export function reactRoles(sources: readonly ParsedSource[], context = true): FileRole[] {
  const roles: FileRole[] = [];
  for (const {path, source} of sources) {
    const add = (role: string) => { if (!roles.some(item => item.path === path && item.role === role)) roles.push({path, role}); };
    for (const [name, declarations] of exportsOf(source)) {
      for (const declaration of declarations) {
        if (declaration.getSourceFile() !== source) continue;
        if ((callable(declaration) || Node.isClassDeclaration(declaration)) && hasJsx(declaration) && (name === 'default' || /^[A-Z]/.test(name))) add('component');
        if (callable(declaration) && /^use[A-Z]/.test(name) && declaration.getDescendantsOfKind(SyntaxKind.CallExpression).some(call => /^use[A-Z]/.test(call.getExpression().getText().split('.').at(-1) ?? ''))) add('hook');
        if (context && declaration.getDescendantsOfKind(SyntaxKind.CallExpression).some(call => importedName(call, 'react') === 'createContext')) add('context');
      }
    }
    if (/(?:^|\/)[^/]+\.config\.[cm]?[jt]s$/.test(path)) add('config');
  }
  return roles;
}
