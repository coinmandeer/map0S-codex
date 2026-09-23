import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { ServerCapabilities } from "@mapos/layer-sdk";
import { viewportCostOf } from "@mapos/layer-sdk";
import {
  allLayerPlugins,
  availableLayerPlugins,
  extraLayerPlugins,
  getLayerManifestV2,
  getLayerPlugin,
  layerUnavailableReason,
  layerIdsForMode,
  primaryLayerForMode,
  registerLayer,
  registerLayerV2,
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
            color: "#000000",
            description: "Duplicate registration fixture",
            category: "travel"
          }
        }),
      /already registered/
    );
  });

  it("derives each mode's primary layer from the manifests", () => {
    assert.equal(primaryLayerForMode("planning"), "osm-poi");
    assert.equal(primaryLayerForMode("game"), "game");
    assert.equal(primaryLayerForMode("mine"), "my-saved-places");
    assert.equal(primaryLayerForMode("discover"), "osm-poi");
    assert.throws(() => primaryLayerForMode("weather"), /No layer claims/);
  });

  it("lists a mode's layers from the manifests rather than a hard-coded set", () => {
    assert.deepEqual(layerIdsForMode("weather"), []);
    assert.ok(layerIdsForMode("planning").includes("osm-poi"));
    assert.ok(layerIdsForMode("mine").includes("my-saved-places"));
  });

  it("treats layers without modes as extras", () => {
    const ids = extraLayerPlugins(null).map((p) => p.manifest.id);
    assert.ok(ids.includes("geology"), "geology belongs to no section");
    assert.ok(
      ids.some((id) => id.startsWith("weather-")),
      "weather is an additive layer, not a mode section"
    );
    assert.ok(!ids.includes("osm-poi"), "osm-poi is a section's primary layer");
    // Park4Night is mode-less too, but its capability is off unless a deployment opts in — so
    // "no section" is not enough to make it an extra.
    assert.ok(!ids.includes("park4night"), "park4night stays hidden without its capability");
  });

  it("hides layers whose capability the server lacks", () => {
    registerLayer({
      ...noopPlugin,
      manifest: {
        id: "test-keyed",
        name: "Keyed",
        icon: "k",
        color: "#000000",
        description: "Capability negotiation fixture",
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
    assert.equal(viewportCostOf(getLayerPlugin("weather-radar")!), "cheap");
    assert.equal(viewportCostOf(getLayerPlugin("game")!), "cheap");
  });

  it("gates geocaching without hiding configured quest sources", () => {
    const without = { opencaching: false } as unknown as ServerCapabilities;
    const withKey = { opencaching: true } as unknown as ServerCapabilities;
    assert.match(
      layerUnavailableReason("game-quests", without, { sources: ["opencaching"] }) ?? "",
      /OKAPI/
    );
    assert.equal(
      layerUnavailableReason("game-quests", withKey, { sources: ["opencaching"] }),
      undefined
    );
    assert.equal(
      layerUnavailableReason("game-quests", without, { sources: ["osm-notes"] }),
      undefined
    );
    assert.equal(
      layerUnavailableReason("game-quests", without, { sources: ["osm-notes", "opencaching"] }),
      undefined
    );
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

    const vanlife = getLayerPlugin("vanlife")!;
    assert.deepEqual(
      vanlife.deriveFilters!(
        { categories: ["camp_site"] },
        { activeTag: null, countryCode: "CZ", enabledPoiSources: ["osm", "user", "mapy"] }
      ),
      { categories: ["camp_site"], sources: ["osm"] }
    );
  });

  it("every registered layer carries the fields the shell reads", () => {
    for (const plugin of allLayerPlugins()) {
      const m = plugin.manifest;
      assert.ok(m.id && m.name && m.icon && m.color, `${m.id} is missing display fields`);
      assert.equal(typeof plugin.create, "function", `${m.id} has no create()`);
    }
  });

  it("hosts v1 and v2 manifests together without special-casing the migrated layer id", () => {
    assert.equal(getLayerManifestV2("osm-poi")?.schemaVersion, "2.0.0");
    const earthquakes = getLayerManifestV2("earthquakes");
    assert.equal(earthquakes?.schema, "mapos.layer-manifest");
    assert.equal(earthquakes?.queryPolicy.maxResultsPerViewport, 100);
    assert.equal(getLayerPlugin("earthquakes")?.manifest.name, "Zemětřesení");
    assert.deepEqual(getLayerPlugin("earthquakes")?.defaultFilters, {
      days: 30,
      minMagnitude: 1
    });
  });

  it("rejects an unknown v2 major without partially registering the layer", () => {
    const before = allLayerPlugins().length;
    assert.throws(
      () =>
        registerLayerV2({
          ...noopPlugin,
          manifest: {
            schema: "mapos.layer-manifest",
            schemaVersion: "3.0.0",
            sdkRange: "^3.0.0",
            id: "future-layer",
            name: "Future",
            description: "Unsupported future contract",
            category: "community",
            geometryKinds: ["Point"],
            renderer: { type: "circles" },
            source: { type: "static" },
            queryPolicy: { strategy: "viewport", maxResultsPerViewport: 100 },
            attribution: [{ label: "Fixture" }],
            capabilities: ["query"]
          }
        }),
      /UNSUPPORTED_SCHEMA_MAJOR/
    );
    assert.equal(allLayerPlugins().length, before);
    assert.equal(getLayerPlugin("future-layer"), undefined);
  });

  it("can be emptied for isolation", () => {
    resetLayerRegistry();
    assert.equal(allLayerPlugins().length, 0);
  });
});
