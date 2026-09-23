import assert from "node:assert/strict";
import test from "node:test";
import {
  createExperienceRegistry,
  legacyLayerModeFor,
  MODE_MANIFESTS,
  resolveAppMode
} from "./registry";

test("the shell registry exposes exactly the canonical modes in product order", () => {
  assert.deepEqual(
    MODE_MANIFESTS.map(({ id }) => id),
    ["personal", "feed", "discover", "planning", "game"]
  );
});

test("legacy mode aliases resolve without reintroducing legacy shell state", () => {
  assert.deepEqual(resolveAppMode("mine"), {
    mode: "personal",
    source: "legacy",
    rewriteUrl: true
  });
  assert.deepEqual(resolveAppMode("weather"), {
    mode: "discover",
    activateLayerId: "weather-radar",
    source: "legacy",
    rewriteUrl: true
  });
  assert.deepEqual(resolveAppMode("poi"), {
    mode: "planning",
    source: "legacy",
    rewriteUrl: true
  });
  // Links to Feed exist under the name the mode was designed with.
  assert.deepEqual(resolveAppMode("social"), {
    mode: "feed",
    source: "legacy",
    rewriteUrl: true
  });
});

test("unknown modes fail safely and the v1 layer bridge is explicit", () => {
  assert.deepEqual(resolveAppMode("future-mode"), {
    mode: "discover",
    source: "fallback",
    rewriteUrl: true
  });
  assert.equal(legacyLayerModeFor("personal"), "mine");
  assert.equal(legacyLayerModeFor("discover"), "discover");
  // Feed is canonical in v2 and has no v1 member to map to, so the bridge reports the nearest
  // one rather than widening the frozen v1 union.
  assert.equal(legacyLayerModeFor("feed"), "discover");
  assert.deepEqual(resolveAppMode("feed"), {
    mode: "feed",
    source: "canonical",
    rewriteUrl: false
  });
});

test("a third world registers from its manifest without a shell switch branch", () => {
  const registry = createExperienceRegistry([
    {
      id: "default",
      name: "Default",
      description: "Base world",
      icon: "◎",
      accent: "#b7791f",
      recommendedIntegrationIds: ["osm-poi"],
      gameIds: []
    }
  ]);
  const fixture = {
    id: "fixture-world",
    name: "Fixture World",
    description: "Third-party world",
    icon: "◇",
    accent: "#2563eb",
    recommendedIntegrationIds: ["earthquakes"],
    gameIds: ["trail-signals"]
  };

  registry.register(fixture);
  assert.deepEqual(
    registry.list().map(({ id }) => id),
    ["default", "fixture-world"]
  );
  assert.deepEqual(registry.get("fixture-world"), fixture);
  assert.throws(() => registry.register(fixture), /already registered/);
  assert.equal(registry.get("unknown-world").id, "default");
});
