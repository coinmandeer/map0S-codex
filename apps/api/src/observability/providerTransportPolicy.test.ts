import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const SOURCE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const NON_PROVIDER_FETCH_MODULES = new Set([
  // Candidate-only loopback acceptance client, not imported by either API server.
  "releaseHttpDrill.ts"
]);

async function productionSources(directory = SOURCE_ROOT): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return productionSources(fullPath);
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
      return [fullPath];
    })
  );
  return nested.flat();
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  node.forEachChild((child) => visit(child, callback));
}

function isDirectFetchCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ((ts.isIdentifier(node.expression) && node.expression.text === "fetch") ||
      (ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "fetch" &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "globalThis"))
  );
}

function isLoggerCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  const level = node.expression.name.text;
  if (!["debug", "info", "log", "warn", "error", "fatal"].includes(level)) return false;
  const owner = node.expression.expression;
  return (
    (ts.isIdentifier(owner) && owner.text === "console") ||
    (ts.isPropertyAccessExpression(owner) && owner.name.text === "log")
  );
}

function containsUnsanitizedError(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "safeErrorLogFields"
  ) {
    return false;
  }
  if (ts.isIdentifier(node) && (node.text === "err" || node.text === "error")) return true;
  let found = false;
  node.forEachChild((child) => {
    if (!found && containsUnsanitizedError(child)) found = true;
  });
  return found;
}

test("production provider calls cannot bypass the DNS-pinned upstream transport", async () => {
  const violations: string[] = [];
  const viemHttpTransports: string[] = [];
  const customHttpsTransports: Array<{ file: string; sourceText: string }> = [];
  for (const file of await productionSources()) {
    const sourceText = await readFile(file, "utf8");
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    visit(source, (node) => {
      if (isDirectFetchCall(node)) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        const relative = path.relative(SOURCE_ROOT, file);
        if (!NON_PROVIDER_FETCH_MODULES.has(relative)) {
          violations.push(`${relative}:${position.line + 1}`);
        }
      }
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        ["http", "https", "node:http", "node:https"].includes(node.moduleSpecifier.text) &&
        path.relative(SOURCE_ROOT, file) !== "utils/upstream.ts"
      ) {
        customHttpsTransports.push({ file: path.relative(SOURCE_ROOT, file), sourceText });
      }
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "viem" &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings) &&
        node.importClause.namedBindings.elements.some(
          (element) => (element.propertyName?.text ?? element.name.text) === "http"
        )
      ) {
        viemHttpTransports.push(path.relative(SOURCE_ROOT, file));
      }
    });
  }
  assert.deepEqual(violations, [], `direct fetch() bypasses: ${violations.join(", ")}`);
  assert.deepEqual(
    viemHttpTransports,
    [],
    "viem http() bypasses the reviewed provider transport boundary"
  );
  assert.deepEqual(
    customHttpsTransports.map(({ file }) => file),
    ["services/declarativeHttpLayerService.ts"],
    "new custom HTTP transports require an explicit security and telemetry review"
  );
  const declarative = customHttpsTransports[0]?.sourceText ?? "";
  for (const required of [
    "isPublicNetworkAddress",
    "pinnedAddresses",
    "providerCircuitBreaker",
    "operationalTelemetry",
    "currentRequestCorrelationId",
    "readBoundedJson"
  ]) {
    assert.match(
      declarative,
      new RegExp(`\\b${required}\\b`),
      `custom transport lacks ${required}`
    );
  }

  const ensResolver = await readFile(
    path.join(SOURCE_ROOT, "services/identity/ensDisplayResolver.ts"),
    "utf8"
  );
  for (const required of ["fetchJson", "validateUpstreamUrl", 'providerId: "ens-rpc"']) {
    assert.ok(ensResolver.includes(required), `ENS RPC adapter lacks ${required}`);
  }
});

test("production logs cannot receive raw Error variables", async () => {
  const violations: string[] = [];
  for (const file of await productionSources()) {
    const sourceText = await readFile(file, "utf8");
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    visit(source, (node) => {
      if (isLoggerCall(node) && node.arguments.some(containsUnsanitizedError)) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push(`${path.relative(SOURCE_ROOT, file)}:${position.line + 1}`);
      }
    });
  }
  assert.deepEqual(violations, [], `raw Error logging at: ${violations.join(", ")}`);
});
