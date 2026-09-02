import assert from "node:assert/strict";
import test from "node:test";
import { resolveCommerceProvider } from "./config.js";

test("commerce is providerless by default and unknown real adapters fail closed", () => {
  assert.equal(resolveCommerceProvider({}, "development"), "none");
  assert.equal(
    resolveCommerceProvider(
      { enabled: "1", provider: "synthetic", syntheticEnabled: "0" },
      "development"
    ),
    "none"
  );
  assert.throws(
    () => resolveCommerceProvider({ enabled: "1", provider: "stripe" }, "development"),
    /no implemented real provider/
  );
});

test("synthetic checkout needs three explicit gates, a secret and a non-production runtime", () => {
  const input = {
    enabled: "1",
    provider: "synthetic",
    syntheticEnabled: "1",
    syntheticSecret: "fixture-secret-that-is-at-least-32-characters"
  };
  assert.equal(resolveCommerceProvider(input, "development"), "synthetic");
  assert.throws(
    () => resolveCommerceProvider({ ...input, syntheticSecret: "short" }, "development"),
    /at least 32/
  );
  assert.throws(() => resolveCommerceProvider(input, "production"), /forbidden in production/);
});
