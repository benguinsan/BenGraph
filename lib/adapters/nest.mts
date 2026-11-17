import { Node, SyntaxKind, type Decorator } from 'ts-morph';
import type { FrameworkFacts } from './types.mts';
import { importedName, literal, type ParsedSource } from './syntax.mts';

const http = new Map([['Get','GET'],['Post','POST'],['Put','PUT'],['Patch','PATCH'],['Delete','DELETE'],['Head','HEAD'],['Options','OPTIONS']]);
function decoratorName(decorator: Decorator): string | undefined {
  const call = decorator.getCallExpression();
  return call ? importedName(call, '@nestjs/common') : undefined;
}
function decoratorPath(decorator: Decorator): string | undefined {
  const args = decorator.getArguments();
  return args.length === 0 ? '' : args.length === 1 ? literal(args[0]) : undefined;
}
function fullPath(...parts: string[]): string | undefined {
  if (parts.some(part => /[?#\\]|\/\//.test(part))) return undefined;
  return '/' + parts.map(part => part.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
}
function globalPrefix(sources: readonly ParsedSource[]): string | undefined {
  let prefix = '';
  let prefixes = 0;
  let applications = 0;
  for (const {source} of sources) {
    if ([...source.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression), ...source.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)]
      .some(expression => importedName(expression, '@nestjs/core') === 'RouterModule')) return undefined;
    if (source.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).some(expression => {
      if (expression.getName() !== 'setGlobalPrefix') return false;
      const parent = expression.getParent();
      return !Node.isCallExpression(parent) || parent.getExpression() !== expression;
    })) return undefined;
    if (source.getDescendantsOfKind(SyntaxKind.ElementAccessExpression).some(expression => literal(expression.getArgumentExpression()) === 'setGlobalPrefix')) return undefined;
    if (source.getDescendantsOfKind(SyntaxKind.BindingElement).some(binding => {
      const property = binding.getPropertyNameNode() ?? binding.getNameNode();
      return (literal(property) ?? property.getText()) === 'setGlobalPrefix';
    })) return undefined;
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      // shortcut: omit multi-app routes, track controller ownership when those routes are needed.
      if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
        const method = Node.isPropertyAccessExpression(expression) ? expression.getName() : literal(expression.getArgumentExpression());
        if (method === 'create' && importedName(expression.getExpression(), '@nestjs/core') === 'NestFactory' && ++applications > 1) return undefined;
      }
      if (Node.isElementAccessExpression(expression)) {
        const name = literal(expression.getArgumentExpression());
        if (name === undefined || ['setGlobalPrefix','enableVersioning','register'].includes(name)) return undefined;
      }
      if (Node.isIdentifier(expression) && ['setGlobalPrefix','enableVersioning'].includes(expression.getText())) return undefined;
      if (!Node.isPropertyAccessExpression(expression)) continue;
      const name = expression.getName();
      if (name === 'enableVersioning' || (name === 'register' && /RouterModule$/.test(expression.getExpression().getText()))) return undefined;
      if (name !== 'setGlobalPrefix') continue;
      const receiver = expression.getExpression();
      const declaration = Node.isIdentifier(receiver) ? receiver.getSymbol()?.getDeclarations().find(Node.isVariableDeclaration) : undefined;
      const awaited = declaration?.getInitializer();
      const creation = awaited && Node.isAwaitExpression(awaited) ? awaited.getExpression() : awaited;
      const factoryCall = creation && Node.isCallExpression(creation) ? creation.getExpression() : undefined;
      if (!factoryCall || !Node.isPropertyAccessExpression(factoryCall) || factoryCall.getName() !== 'create' || importedName(factoryCall.getExpression(), '@nestjs/core') !== 'NestFactory') return undefined;
      const args = call.getArguments();
      const value = args.length === 1 ? literal(args[0]) : undefined;
      if (value === undefined || ++prefixes !== 1) return undefined;
      if (call.getAncestors().some(ancestor => {
        if (Node.isBinaryExpression(ancestor) && [SyntaxKind.AmpersandAmpersandToken, SyntaxKind.BarBarToken, SyntaxKind.QuestionQuestionToken, SyntaxKind.AmpersandAmpersandEqualsToken, SyntaxKind.BarBarEqualsToken, SyntaxKind.QuestionQuestionEqualsToken].includes(ancestor.getOperatorToken().getKind())) return true;
        return Node.isIfStatement(ancestor) || Node.isConditionalExpression(ancestor) || Node.isForStatement(ancestor) || Node.isForOfStatement(ancestor) || Node.isForInStatement(ancestor) || Node.isWhileStatement(ancestor) || Node.isDoStatement(ancestor) || Node.isSwitchStatement(ancestor) || Node.isTryStatement(ancestor);
      })) return undefined;
      prefix = value;
    }
    if (source.getImportDeclarations().some(declaration => declaration.getModuleSpecifierValue() === '@nestjs/core' && declaration.getNamedImports().some(specifier => specifier.getName() === 'RouterModule'))) return undefined;
  }
  return prefix;
}

export function nestFacts(sources: readonly ParsedSource[]): FrameworkFacts {
  const roles: FrameworkFacts['roles'] = [];
  const routes: FrameworkFacts['routes'] = [];
  const prefix = globalPrefix(sources);
  for (const {path, source} of sources) {
    const suffix = path.match(/\.(controller|service|module|entity|guard|middleware)\.[cm]?[jt]s$/)?.[1];
    if (suffix) roles.push({path,role:suffix});
    if (/(?:^|\/)[^/]+\.config\.[cm]?[jt]s$/.test(path)) roles.push({path,role:'config'});
    if (prefix === undefined) continue;
    for (const controller of source.getClasses()) {
      if (controller.getExtends()) continue;
      const decorators = controller.getDecorators();
      const controllers = decorators.filter(decorator => decoratorName(decorator) === 'Controller');
      if (controllers.length !== 1 || decorators.some(decorator => decoratorName(decorator) === undefined || decoratorName(decorator) === 'Version')) continue;
      const base = decoratorPath(controllers[0]);
      if (base === undefined) continue;
      for (const method of controller.getMethods()) {
        if (!method.getBody() || method.getDecorators().some(decorator => decoratorName(decorator) === undefined || decoratorName(decorator) === 'Version')) continue;
        const handlers = method.getDecorators().filter(decorator => http.has(decoratorName(decorator) ?? ''));
        if (handlers.length !== 1) continue;
        const decorator = handlers[0];
        const subpath = decoratorPath(decorator);
        const verb = http.get(decoratorName(decorator) ?? '');
        if (subpath === undefined || !verb) continue;
        const combined = fullPath(prefix, base, subpath);
        if (combined !== undefined) routes.push({file:path, method:verb, path:combined});
      }
    }
  }
  return {framework:'nestjs', roles, routes};
}
