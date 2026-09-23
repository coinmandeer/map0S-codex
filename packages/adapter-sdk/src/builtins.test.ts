import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_ADAPTERS, createBuiltInAdapterRegistry } from "./builtins.js";
import { detectSource } from "./registry.js";

/** The URLs a user actually pastes, and which adapter each has to reach. Ambiguity between
 *  these is the failure the wizard would show as "we cannot read this address". */
const ROUTES: Array<[string, string]> = [
  ["https://x.org/tiles/europe.pmtiles", "pmtiles"],
  ["https://x.org/service?SERVICE=WMTS", "wmts"],
  ["https://x.org/wmts/1.0.0/WMTSCapabilities.xml", "wmts"],
  ["pmtiles://https://x.org/tiles/europe.pmtiles", "pmtiles"],
  ["https://x.org/arcgis/rest/services/flood/MapServer", "arcgis"],
  ["https://x.org/arcgis/rest/services/parcels/FeatureServer/1", "arcgis"],
  ["https://x.org/geoserver/ows?service=WMS&request=GetCapabilities", "wms"],
  ["https://x.org/geoserver/wms", "wms"],
  // An ArcGIS service's WMS façade speaks WMS, and only the WMS adapter can read it.
  ["https://x.org/arcgis/services/a/MapServer/WMSServer", "wms"]
];

test("every pasted address reaches exactly one adapter, and the right one", () => {
  for (const [url, expected] of ROUTES) {
    const [best, ...rest] = detectSource(url, BUILT_IN_ADAPTERS);
    assert.equal(best?.adapter.id, expected, url);
    // A runner-up at the same confidence would make the choice arbitrary.
    assert.ok(
      rest.every((candidate) => candidate.confidence < (best?.confidence ?? 0)),
      `${url} is ambiguous between ${best?.adapter.id} and ${rest[0]?.adapter.id}`
    );
  }
});

test("an address none of them recognise produces no candidates", () => {
  assert.deepEqual(detectSource("https://x.org/data/places.json", BUILT_IN_ADAPTERS), []);
  assert.deepEqual(detectSource("not a url", BUILT_IN_ADAPTERS), []);
});

test("each registry is its own, so a test adapter cannot leak into the app", () => {
  const registry = createBuiltInAdapterRegistry();
  registry.register({
    id: "fake",
    label: "Fake",
    kinds: ["geojson"],
    detect: () => 1,
    probe: () => {
      throw new Error("unused");
    },
    describe: () => {
      throw new Error("unused");
    }
  });
  assert.equal(registry.list().length, BUILT_IN_ADAPTERS.length + 1);
  assert.equal(createBuiltInAdapterRegistry().list().length, BUILT_IN_ADAPTERS.length);
});
