import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyModuleFailure } from "./ModuleErrorBoundary";

describe("ModuleErrorBoundary failure classification", () => {
  it("routes cached lazy-import failures to the reliable full reload recovery", () => {
    assert.equal(
      classifyModuleFailure(new TypeError("Failed to fetch dynamically imported module")),
      "chunk-load"
    );
    assert.equal(classifyModuleFailure(new Error("Loading chunk 42 failed")), "chunk-load");
  });

  it("keeps ordinary render failures on a local remount path", () => {
    assert.equal(classifyModuleFailure(new Error("component render failed")), "render");
    assert.equal(classifyModuleFailure({ privatePayload: "never inspected" }), "render");
  });
});
