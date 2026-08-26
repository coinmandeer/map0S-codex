import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { ServerCapabilities } from "@mapos/layer-sdk";
import { viewportCostOf } from "@mapos/layer-sdk";
import {
  allLayerPlugins,
  availableLayerPlugins,
  extraLayerPlugins,
  getLayerPlugin,
  layerIdsForMode,
  primaryLayerForMode,
  registerLayer,
  resetLayerRegistry
} from "./registry";
import "./builtins";

const noopPlugin = {
  kind: "pins" as const,
  create: () => ({
    update: async () => null,
    setVisible: () => {},
    setOpacity: () => {},
    detach: () => {}
  })
};

describe("layer registry", () => {
  const added: string[] = [];
  after(() => {
    for (const id of added) void id;
  });

  it("refuses duplicate ids", () => {
    // Two layers under one id would silently share map sources, URL state and cache entries;
    // failing loudly at registration is the only place this is cheap to catch.
    assert.throws(
      () =>
        registerLayer({
          ...noopPlugin,
          manifest: {
            id: "osm-poi",
            name: "Dup",
            icon: "x",
            color: "#000",
            description: "",
            category: "travel"
          }
        }),
      /already registered/
    );
  });

  it("derives each mode's primary layer from the manifests", () => {
    assert.equal(primaryLayerForMode("poi"), "osm-poi");
    assert.equal(primaryLayerForMode("weather"), "weather");
    assert.equal(primaryLayerForMode("game"), "game");
    assert.equal(primaryLayerForMode("mine"), "user-layers");
    assert.equal(primaryLayerForMode("discover"), "osm-poi");
  });

  it("lists a mode's layers from the manifests rather than a hard-coded set", () => {
    assert.deepEqual(layerIdsForMode("weather"), ["weather"]);
    assert.ok(layerIdsForMode("poi").includes("osm-poi"));
  });

  it("treats layers without modes as extras", () => {
    const ids = extraLayerPlugins(null).map((p) => p.manifest.id);
    assert.ok(ids.includes("park4night"), "park4night belongs to no section");
    assert.ok(!ids.includes("osm-poi"), "osm-poi is a section's primary layer");
  });

  it("hides layers whose capability the server lacks", () => {
    registerLayer({
      ...noopPlugin,
      manifest: {
        id: "test-keyed",
        name: "Keyed",
        icon: "k",
        color: "#000",
        description: "",
        category: "travel",
        requiresCapability: "mapy"
      }
    });
    added.push("test-keyed");

    const without = { mapy: false } as unknown as ServerCapabilities;
    const with_ = { mapy: true } as unknown as ServerCapabilities;
    assert.ok(!availableLayerPlugins(without).some((p) => p.manifest.id === "test-keyed"));
    assert.ok(availableLayerPlugins(with_).some((p) => p.manifest.id === "test-keyed"));
    // A layer with no capability requirement is always offered.
    assert.ok(availableLayerPlugins(without).some((p) => p.manifest.id === "osm-poi"));
  });

  it("defaults viewport cost by kind so pin layers wait for Search here", () => {
    assert.equal(viewportCostOf(getLayerPlugin("osm-poi")!), "expensive");
    assert.equal(viewportCostOf(getLayerPlugin("weather")!), "cheap");
    assert.equal(viewportCostOf(getLayerPlugin("game")!), "cheap");
  });

  it("folds app state into filters through deriveFilters, not engine branches", () => {
    const osm = getLayerPlugin("osm-poi")!;
    const derived = osm.deriveFilters!(
      { categories: ["castle"] },
      { activeTag: null, countryCode: "CZ", enabledPoiSources: ["osm", "mapy"] }
    );
    assert.deepEqual(derived, { categories: ["castle"], sources: ["osm", "mapy"] });

    const mine = getLayerPlugin("user-layers")!;
    assert.deepEqual(
      mine.deriveFilters!({}, { activeTag: "vylet", countryCode: "CZ", enabledPoiSources: [] }),
      { tag: "vylet", country: "CZ" }
    );
    // An absent tag must not become the string "null" in the query.
    assert.deepEqual(
      mine.deriveFilters!({}, { activeTag: null, countryCode: "CZ", enabledPoiSources: [] }),
      { country: "CZ" }
    );
  });

  it("every registered layer carries the fields the shell reads", () => {
    for (const plugin of allLayerPlugins()) {
      const m = plugin.manifest;
      assert.ok(m.id && m.name && m.icon && m.color, `${m.id} is missing display fields`);
      assert.equal(typeof plugin.create, "function", `${m.id} has no create()`);
    }
  });

  it("can be emptied for isolation", () => {
    resetLayerRegistry();
    assert.equal(allLayerPlugins().length, 0);
  });
});
