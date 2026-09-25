import assert from "node:assert/strict";
import test from "node:test";
import {
  MAPOS_HOST_RUNTIME_VERSION,
  MAPOS_LAYER_SDK_RANGE,
  MAPOS_V2_SCHEMA_VERSION,
  type LayerManifestV2
} from "@mapos/layer-sdk";
import { availableLayerPlugins, getLayerManifestV2, getLayerPlugin } from "./registry";
import { sourceLayerId, syncSourceLayers, wmsTimeTemplate } from "./sourceLayers";

test("WMS time filtering replaces only TIME and retains the raw tile bbox placeholder", () => {
  const layer = manifest({
    source: {
      type: "raster-tiles",
      adapterId: "wms",
      tileTemplate: "https://example.wms/service?TIME=old&token=public&bbox={bbox-epsg-3857}"
    },
    filters: [
      {
        id: "wmsTime",
        kind: "single-select",
        label: "Time",
        providerField: "TIME",
        default: "2026-09-01",
        options: [
          { id: "2026-09-01", label: "1" },
          { id: "2026-09-02", label: "2" }
        ]
      }
    ]
  });
  const changed = wmsTimeTemplate(layer, "2026-09-02");
  assert.ok(changed.includes("bbox={bbox-epsg-3857}"));
  const url = new URL(changed);
  assert.equal(url.searchParams.get("time"), "2026-09-02");
  assert.equal(url.searchParams.has("TIME"), false);
  assert.equal(url.searchParams.get("token"), "public");
  assert.equal(
    new URL(wmsTimeTemplate(layer, "evil&layers=other")).searchParams.get("time"),
    "2026-09-01"
  );
});

function manifest(overrides: Partial<LayerManifestV2> = {}): LayerManifestV2 {
  return {
    schema: "mapos.layer-manifest",
    schemaVersion: MAPOS_V2_SCHEMA_VERSION,
    sdkRange: MAPOS_LAYER_SDK_RANGE,
    minimumRuntime: MAPOS_HOST_RUNTIME_VERSION,
    id: "src-abc",
    name: "Zkušební služba",
    description: "WMS 1.3.0",
    category: "user",
    geometryKinds: ["Raster"],
    renderer: { type: "raster" },
    source: {
      type: "raster-tiles",
      tileTemplate: "https://example.wms/service?request=GetMap&bbox={bbox-epsg-3857}",
      adapterId: "wms"
    },
    queryPolicy: { strategy: "tile" },
    capabilities: [],
    ...overrides
  } as LayerManifestV2;
}

const LAYER = {
  id: "layer-1",
  name: "Zaplavy z URL",
  color: "#0ea5e9",
  sourceManifest: manifest()
};

test("the registry id survives an id the manifest schema would reject", () => {
  // The offline server mints case-sensitive nanoids; the schema allows lowercase only.
  const id = sourceLayerId("2V-8NFWXKvfyz9Vd");
  assert.match(id, /^[a-z0-9][a-z0-9._-]{1,99}$/);
  // Two ids differing only in case must not collapse onto one layer.
  assert.notEqual(sourceLayerId("abc"), sourceLayerId("ABC"));
});

test("a stored manifest becomes a registered, available layer", () => {
  const added = syncSourceLayers([LAYER]);
  assert.deepEqual(added, [sourceLayerId("layer-1")]);

  const registered = getLayerManifestV2(sourceLayerId("layer-1"));
  // The user's own name wins over whatever the service called itself.
  assert.equal(registered?.name, "Zaplavy z URL");
  assert.equal(registered?.category, "user");

  // Availability is what decides whether the drawer lists it, so a layer that registers but is
  // negotiated away is the same as no layer at all.
  const listed = availableLayerPlugins(null).map((plugin) => plugin.manifest.id);
  assert.ok(listed.includes(sourceLayerId("layer-1")), listed.join(", "));
});

test("syncing again is a no-op rather than a duplicate registration", () => {
  syncSourceLayers([LAYER]);
  assert.deepEqual(syncSourceLayers([LAYER]), []);
});

test("a layer the user deleted is unregistered", () => {
  syncSourceLayers([LAYER]);
  assert.deepEqual(syncSourceLayers([]), [sourceLayerId("layer-1")]);
  assert.equal(getLayerManifestV2(sourceLayerId("layer-1")), undefined);
});

test("changed source settings replace only that plugin and unchanged input preserves identity", () => {
  syncSourceLayers([]);
  const other = { ...LAYER, id: "untouched" };
  syncSourceLayers([LAYER, other]);
  const id = sourceLayerId(LAYER.id);
  const previous = getLayerPlugin(id);
  const untouched = getLayerPlugin(sourceLayerId(other.id));
  const updated = {
    ...LAYER,
    name: "Nové záplavy",
    color: "#ff8800",
    sourceManifest: manifest({
      source: { type: "raster-tiles", tileTemplate: "https://example.test/new/{z}/{x}/{y}.png" }
    })
  };
  assert.deepEqual(syncSourceLayers([updated, other]), [id]);
  assert.notEqual(getLayerPlugin(id), previous);
  assert.equal(getLayerPlugin(sourceLayerId(other.id)), untouched);
  assert.equal(getLayerManifestV2(id)?.name, "Nové záplavy");
  assert.deepEqual(getLayerManifestV2(id)?.source, updated.sourceManifest.source);
  const current = getLayerPlugin(id);
  assert.deepEqual(syncSourceLayers([structuredClone(updated), other]), []);
  assert.equal(getLayerPlugin(id), current);
  syncSourceLayers([]);
});

test("an invalid update preserves the last working registration", () => {
  syncSourceLayers([LAYER]);
  const id = sourceLayerId(LAYER.id);
  const previous = getLayerPlugin(id);
  assert.deepEqual(
    syncSourceLayers([
      { ...LAYER, sourceManifest: manifest({ schemaVersion: "invalid" as never }) }
    ]),
    []
  );
  assert.equal(getLayerPlugin(id), previous);
  syncSourceLayers([]);
});

test("pin layers and unknown adapters are ignored", () => {
  assert.deepEqual(
    syncSourceLayers([
      { id: "pins", name: "Moje místa", color: "#fff" },
      {
        id: "features",
        name: "FeatureServer",
        color: "#fff",
        // Queried per viewport by the API, not fetched from the browser.
        sourceManifest: manifest({
          id: "src-feature",
          source: { type: "server-adapter", adapterId: "unknown", endpoint: "https://x/query" }
        })
      }
    ]),
    []
  );
});

test("a FeatureServer manifest is registered for viewport queries", () => {
  const layer = {
    id: "features-ready",
    name: "FeatureServer",
    color: "#00aa88",
    sourceManifest: manifest({
      geometryKinds: ["Point", "LineString"],
      renderer: { type: "symbols" },
      source: {
        type: "server-adapter",
        adapterId: "arcgis",
        endpoint: "https://x.test/FeatureServer/0/query"
      },
      queryPolicy: { strategy: "viewport", minZoom: 9 }
    })
  };
  assert.deepEqual(syncSourceLayers([layer]), [sourceLayerId(layer.id)]);
  assert.equal(getLayerManifestV2(sourceLayerId(layer.id))?.source.type, "server-adapter");
  syncSourceLayers([]);
});
