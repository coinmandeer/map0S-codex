import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

interface DivergenceEntry {
  method: string;
  path: string;
  auth: string;
  schemaIntent: string;
  reason: string;
  status: string;
  target: string;
}

interface RouteParityEvidence {
  schemaVersion: number;
  inventory: {
    productionComposition: string;
    memoryComposition: string;
    machineVerifier: string;
    expectedProductionRouteCount: number;
    expectedMemoryRouteCount: number;
    expectedSharedRouteCount: number;
    productionOnly: DivergenceEntry[];
    memoryOnly: DivergenceEntry[];
  };
  intentionalBehaviorDifferences: Array<{
    routes: string[];
    production: string;
    memory: string;
    verification: string;
  }>;
  sharedCreateAppPlan: { goal: string; steps: string[]; exitCriterion: string };
}

function routeKey(method: string, path: string) {
  return `${method.toUpperCase()} ${path}`;
}

function staticString(node: ts.Node | undefined): string | null {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
    return node.text;
  }
  return null;
}

function property(object: ts.ObjectLiteralExpression, name: string) {
  return object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      ((ts.isIdentifier(candidate.name) && candidate.name.text === name) ||
        (ts.isStringLiteral(candidate.name) && candidate.name.text === name))
  )?.initializer;
}

function resolveTypeScriptImport(sourceFile: string, specifier: string) {
  const absolute = resolve(dirname(sourceFile), specifier);
  const candidates = absolute.endsWith(".js")
    ? [absolute.slice(0, -3) + ".ts", absolute]
    : [absolute + ".ts", resolve(absolute, "index.ts"), absolute];
  return candidates.find(existsSync) ?? null;
}

/**
 * Static inventory deliberately follows only imported register* functions invoked by a
 * composition root. It therefore records the routes that can actually be registered without
 * importing either server (which would require production secrets/database state).
 */
function composeRouteInventory(compositionPath: string) {
  const routes = new Set<string>();
  const visited = new Set<string>();
  const pending = [resolve(REPO_ROOT, compositionPath)];

  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const registrarImports = new Map<string, string>();
    const constants = new Map<string, ts.Expression>();
    const wrappers = new Map<string, ts.FunctionDeclaration>();
    const collect = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isVariableDeclarationList(node.parent) &&
        node.parent.flags & ts.NodeFlags.Const
      ) {
        constants.set(node.name.text, node.initializer);
      }
      if (ts.isFunctionDeclaration(node) && node.name) wrappers.set(node.name.text, node);
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);
    const textValue = (
      node: ts.Node | undefined,
      bindings = new Map<string, string>(),
      depth = 0
    ): string | null => {
      if (!node || depth > 10) return null;
      const literal = staticString(node);
      if (literal !== null) return literal;
      if (ts.isIdentifier(node)) {
        return bindings.get(node.text) ?? textValue(constants.get(node.text), bindings, depth + 1);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = textValue(node.left, bindings, depth + 1);
        const right = textValue(node.right, bindings, depth + 1);
        return left !== null && right !== null ? left + right : null;
      }
      return null;
    };

    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.moduleSpecifier.text.startsWith(".") ||
        !statement.importClause?.namedBindings ||
        !ts.isNamedImports(statement.importClause.namedBindings)
      ) {
        continue;
      }
      const importedFile = resolveTypeScriptImport(file, statement.moduleSpecifier.text);
      if (!importedFile) continue;
      for (const element of statement.importClause.namedBindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (importedName.startsWith("register")) {
          registrarImports.set(element.name.text, importedFile);
        }
      }
    }

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression)) {
          const importedRegistrar = registrarImports.get(node.expression.text);
          if (importedRegistrar) pending.push(importedRegistrar);
          const wrapper = wrappers.get(node.expression.text);
          if (wrapper?.body) {
            const bindings = new Map<string, string>();
            wrapper.parameters.forEach((parameter, index) => {
              const value = textValue(node.arguments[index]);
              if (ts.isIdentifier(parameter.name) && value !== null)
                bindings.set(parameter.name.text, value);
            });
            const inspectWrapper = (inner: ts.Node) => {
              if (
                ts.isCallExpression(inner) &&
                ts.isPropertyAccessExpression(inner.expression) &&
                ts.isIdentifier(inner.expression.expression) &&
                inner.expression.expression.text === "app" &&
                HTTP_METHODS.has(inner.expression.name.text.toLowerCase())
              ) {
                const path = textValue(inner.arguments[0], bindings);
                if (path) routes.add(routeKey(inner.expression.name.text, path));
              }
              ts.forEachChild(inner, inspectWrapper);
            };
            inspectWrapper(wrapper.body);
          }
        }

        if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "app"
        ) {
          const callName = node.expression.name.text.toLowerCase();
          if (HTTP_METHODS.has(callName)) {
            const path = textValue(node.arguments[0]);
            if (path) routes.add(routeKey(callName, path));
          } else if (callName === "route") {
            const definition = node.arguments[0];
            if (definition && ts.isObjectLiteralExpression(definition)) {
              const path = staticString(property(definition, "url"));
              const methodNode = property(definition, "method");
              const methods =
                methodNode && ts.isArrayLiteralExpression(methodNode)
                  ? methodNode.elements
                      .map(staticString)
                      .filter((value): value is string => Boolean(value))
                  : [staticString(methodNode)].filter((value): value is string => Boolean(value));
              if (path) for (const method of methods) routes.add(routeKey(method, path));
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return routes;
}

function difference(left: Set<string>, right: Set<string>) {
  return [...left].filter((route) => !right.has(route)).sort();
}

function intersection(left: Set<string>, right: Set<string>) {
  return [...left].filter((route) => right.has(route)).sort();
}

const evidence = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "docs/api-route-parity.json"), "utf8")
) as RouteParityEvidence;

test("production and memory route sets differ only where machine-readable evidence allows it", () => {
  const production = composeRouteInventory(evidence.inventory.productionComposition);
  const memory = composeRouteInventory(evidence.inventory.memoryComposition);
  const productionOnly = difference(production, memory);
  const memoryOnly = difference(memory, production);
  // Shared helper-registered routes must be included, not just literal app.get('/...') calls.
  for (const key of [
    "GET /v2/world/capabilities",
    "GET /v2/world/live",
    "POST /v2/world/session",
    "POST /v2/world/threads/reply",
    "POST /v2/world/threads/save"
  ]) {
    assert.ok(production.has(key) && memory.has(key), `missing helper-registered route: ${key}`);
  }

  assert.deepEqual(
    productionOnly,
    evidence.inventory.productionOnly.map((entry) => routeKey(entry.method, entry.path)).sort(),
    "production gained/lost a route without updating its intentional divergence evidence"
  );
  assert.deepEqual(
    memoryOnly,
    evidence.inventory.memoryOnly.map((entry) => routeKey(entry.method, entry.path)).sort(),
    "memory gained/lost a route without updating its intentional divergence evidence"
  );
  assert.equal(production.size, evidence.inventory.expectedProductionRouteCount);
  assert.equal(memory.size, evidence.inventory.expectedMemoryRouteCount);
  assert.equal(
    intersection(production, memory).length,
    evidence.inventory.expectedSharedRouteCount
  );
});

test("every intentional route divergence carries auth, schema, reason and retirement intent", () => {
  assert.equal(evidence.schemaVersion, 1);
  const entries = [...evidence.inventory.productionOnly, ...evidence.inventory.memoryOnly];
  const keys = entries.map((entry) => routeKey(entry.method, entry.path));
  assert.equal(new Set(keys).size, keys.length, "duplicate divergence evidence");
  for (const entry of entries) {
    assert.ok(entry.auth.trim(), `${routeKey(entry.method, entry.path)} has no auth intent`);
    assert.ok(
      entry.schemaIntent.trim(),
      `${routeKey(entry.method, entry.path)} has no schema intent`
    );
    assert.ok(entry.reason.trim(), `${routeKey(entry.method, entry.path)} has no reason`);
    assert.ok(entry.status.trim(), `${routeKey(entry.method, entry.path)} has no status`);
    assert.ok(
      entry.target.trim(),
      `${routeKey(entry.method, entry.path)} has no convergence target`
    );
  }
  assert.ok(evidence.intentionalBehaviorDifferences.length > 0);
  for (const difference of evidence.intentionalBehaviorDifferences) {
    assert.ok(difference.routes.length > 0);
    assert.ok(difference.production.trim());
    assert.ok(difference.memory.trim());
    assert.ok(difference.verification.trim());
  }
  assert.ok(evidence.sharedCreateAppPlan.steps.length >= 3);
  assert.ok(evidence.sharedCreateAppPlan.exitCriterion.trim());
});
