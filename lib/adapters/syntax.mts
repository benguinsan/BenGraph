import { Node, SyntaxKind, ts, type SourceFile, type Symbol as TsMorphSymbol } from 'ts-morph';
export type ParsedSource = {path: string; source: SourceFile};

export function literal(node: Node | undefined): string | undefined {
  return node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node.getLiteralText() : undefined;
}

export function unwrap(node: Node | undefined): Node | undefined {
  while (node && (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isTypeAssertion(node))) node = node.getExpression();
  return node;
}

function erased(node: Node): boolean {
  return node.getSourceFile().isDeclarationFile() || [node, ...node.getAncestors()].some(ancestor => Node.isAmbientable(ancestor) && ancestor.isAmbient());
}

export function callable(node: Node): boolean {
  if (erased(node)) return false;
  const symbol = node.getSymbol();
  if (symbol && node.getSourceFile().getDescendantsOfKind(SyntaxKind.BinaryExpression).some(expression => {
    const kind = expression.getOperatorToken().getKind();
    return kind >= SyntaxKind.FirstAssignment && kind <= SyntaxKind.LastAssignment && expression.getLeft().getSymbol() === symbol;
  })) return false;
  if (Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node)) return !!node.getBody();
  if (Node.isVariableDeclaration(node)) {
    if (node.getVariableStatement()?.getDeclarationKind() !== 'const') return false;
    const initializer = unwrap(node.getInitializer());
    return !!initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer));
  }
  return false;
}

function runtimeExport(source: SourceFile, name: string, seen: Set<string>): boolean {
  if (source.isDeclarationFile()) return false;
  const key = `${source.getFilePath()}\0${name}`;
  if (seen.has(key)) return false;
  seen = new Set(seen).add(key);
  const local = (declaration: Node): boolean => {
    if (erased(declaration)) return false;
    if (Node.isImportSpecifier(declaration)) {
      const imported = declaration.getImportDeclaration();
      const target = imported.getModuleSpecifierSourceFile();
      return !declaration.isTypeOnly() && !imported.isTypeOnly() && !!target && runtimeExport(target, declaration.getName(), seen);
    }
    if (Node.isImportClause(declaration)) {
      const imported = declaration.getParent();
      const target = Node.isImportDeclaration(imported) ? imported.getModuleSpecifierSourceFile() : undefined;
      return !declaration.isTypeOnly() && !!target && runtimeExport(target, 'default', seen);
    }
    return Node.isFunctionDeclaration(declaration) || Node.isClassDeclaration(declaration) || Node.isVariableDeclaration(declaration);
  };
  if ([...source.getFunctions(), ...source.getClasses()].some(declaration => !erased(declaration) && declaration.hasExportKeyword() && (declaration.hasDefaultKeyword() ? name === 'default' : declaration.getName() === name))) return true;
  if (source.getVariableStatements().some(statement => !erased(statement) && statement.hasExportKeyword() && statement.getDeclarations().some(declaration => declaration.getName() === name))) return true;
  if (name === 'default' && source.getExportAssignments().some(assignment => {
    const expression = unwrap(assignment.getExpression());
    return !!expression && (!Node.isIdentifier(expression) || (expression.getSymbol()?.getDeclarations() ?? []).some(local));
  })) return true;
  for (const declaration of source.getExportDeclarations()) {
    if (declaration.isTypeOnly()) continue;
    const target = declaration.getModuleSpecifierSourceFile();
    const specifiers = declaration.getNamedExports();
    if (!specifiers.length && !declaration.getNamespaceExport() && name !== 'default' && target && runtimeExport(target, name, seen)) return true;
    for (const specifier of specifiers) {
      if (specifier.isTypeOnly() || (specifier.getAliasNode()?.getText() ?? specifier.getName()) !== name) continue;
      if (target ? runtimeExport(target, specifier.getName(), seen) : specifier.getLocalTargetDeclarations().some(local)) return true;
    }
  }
  return false;
}

/** ES module exports only; route extraction relies on this because CommonJS route files aren't proven to be served. */
export function exportsOf(source: SourceFile): ReadonlyMap<string, readonly Node[]> {
  return new Map([...source.getExportedDeclarations()].filter(([name]) => runtimeExport(source, name, new Set())));
}

/** Names assigned to module.exports or exports at the top level; exports assembled inside branches or functions are not read. */
function commonJsExports(source: SourceFile): ReadonlyMap<string, readonly Node[]> {
  const exported = new Map<string, Node[]>();
  const local = (symbol: TsMorphSymbol | undefined) => symbol?.getDeclarations().find(declaration => declaration.getSourceFile() === source);
  const add = (name: string, value: Node | undefined) => {
    const node = unwrap(value);
    const declaration = node && Node.isIdentifier(node) ? local(node.getSymbol()) : node;
    exported.delete(name);
    if (declaration) exported.set(name, [declaration]);
  };
  // After module.exports or the bare exports alias is reassigned, the alias no longer reaches the module.
  let rebound = false;
  for (const statement of source.getStatements()) {
    const expression = Node.isExpressionStatement(statement) ? statement.getExpression() : undefined;
    if (!expression || !Node.isBinaryExpression(expression) || expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const target = expression.getLeft().getText();
    const value = expression.getRight();
    if (target === 'exports') { rebound = true; continue; }
    if (target === 'module.exports') {
      exported.clear();
      rebound = true;
      const object = unwrap(value);
      if (!object || !Node.isObjectLiteralExpression(object)) { add('default', value); continue; }
      for (const property of object.getProperties()) {
        if (Node.isShorthandPropertyAssignment(property)) {
          const declaration = local(property.getValueSymbol());
          if (declaration) exported.set(property.getName(), [declaration]);
        } else if ((Node.isPropertyAssignment(property) || Node.isMethodDeclaration(property)) && !Node.isComputedPropertyName(property.getNameNode())) {
          add(property.getName(), Node.isPropertyAssignment(property) ? property.getInitializer() : property);
        }
      }
      continue;
    }
    const match = target.match(/^(module\.)?exports\.([A-Za-z_$][\w$]*)$/);
    if (match && (match[1] || !rebound)) add(match[2], value);
  }
  return exported;
}

/** Runtime exports of either module system, for adapters that only need a file's names. */
export function moduleExports(source: SourceFile): ReadonlyMap<string, readonly Node[]> {
  const commonJs = commonJsExports(source);
  // A file with ES syntax can still assign module.exports under a CommonJS transform; ES names win on conflict.
  return ts.isExternalModule(source.compilerNode) ? new Map([...commonJs, ...exportsOf(source)]) : commonJs;
}

export function importedName(node: Node, module: string): string | undefined {
  const target = Node.isCallExpression(node) ? node.getExpression() : node;
  if (Node.isIdentifier(target)) {
    const declarations = target.getSymbol()?.getDeclarations() ?? [];
    const specifier = declarations.find(Node.isImportSpecifier);
    if (specifier && !specifier.isTypeOnly() && !specifier.getImportDeclaration().isTypeOnly() && specifier.getImportDeclaration().getModuleSpecifierValue() === module) return specifier.getName();
  }
  if (Node.isPropertyAccessExpression(target) || Node.isElementAccessExpression(target)) {
    const left = target.getExpression();
    if (Node.isIdentifier(left)) {
      const namespace = left.getSymbol()?.getDeclarations().find(Node.isNamespaceImport);
      const declaration = namespace?.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
      if (declaration && !declaration.isTypeOnly() && declaration.getModuleSpecifierValue() === module) return Node.isPropertyAccessExpression(target) ? target.getName() : literal(target.getArgumentExpression());
    }
  }
  return undefined;
}

export function hasJsx(node: Node): boolean {
  return node.getDescendants().some(child => child.getKind() === SyntaxKind.JsxElement || child.getKind() === SyntaxKind.JsxSelfClosingElement || child.getKind() === SyntaxKind.JsxFragment);
}
