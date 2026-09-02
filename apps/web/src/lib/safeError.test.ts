import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { safeBrowserErrorFields } from "./safeError.js";

const SOURCE_ROOT = fileURLToPath(new URL("../", import.meta.url));

async function productionSources(directory = SOURCE_ROOT): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return productionSources(fullPath);
        if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".test.ts")) return [];
        return [fullPath];
      })
    )
  ).flat();
}

function containsRawError(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "safeBrowserErrorFields"
  ) {
    return false;
  }
  if (
    ts.isIdentifier(node) &&
    (node.text === "err" || node.text === "error" || node.text === "event")
  ) {
    return true;
  }
  let found = false;
  node.forEachChild((child) => {
    if (!found && containsRawError(child)) found = true;
  });
  return found;
}

test("browser error fields never retain message, URL or private input", () => {
  const error = new Error("https://tiles.test/{z}/{x}/{y}?key=secret&bbox=13,49,14,50");
  error.name = "Bad name key=secret";
  assert.deepEqual(safeBrowserErrorFields(error), { errorName: "Error" });
  assert.deepEqual(safeBrowserErrorFields(new TypeError("private filter")), {
    errorName: "TypeError"
  });
});

test("production browser loggers cannot receive raw error or event objects", async () => {
  const violations: string[] = [];
  for (const file of await productionSources()) {
    const source = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "console" &&
        node.arguments.some(containsRawError)
      ) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push(`${path.relative(SOURCE_ROOT, file)}:${position.line + 1}`);
      }
      node.forEachChild(visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, [], `raw browser error logging at: ${violations.join(", ")}`);
});
