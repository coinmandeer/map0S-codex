import assert from "node:assert/strict";
import test from "node:test";
import { validateLayerManifestV2 } from "@mapos/layer-sdk";
import type { AdapterIo } from "../contract.js";
import { SourceProbeError } from "../contract.js";
import { arcgisAdapter, arcgisPastedSublayer } from "./arcgisAdapter.js";

const MAP_SERVER = {
  currentVersion: 10.91,
  mapName: "Povodňová mapa",
  serviceDescription: "Flood hazard",
  copyrightText: "© VÚV TGM",
  capabilities: "Map,Query,Data",
  singleFusedMapCache: false,
  supportedImageFormatTypes: "PNG32,PNG24,JPG",
  spatialReference: { wkid: 102100, latestWkid: 3857 },
  layers: [
    { id: 0, name: "Q5", defaultVisibility: true },
    { id: 1, name: "Q100", defaultVisibility: false }
  ]
};

const CACHED_MAP_SERVER = {
  ...MAP_SERVER,
  singleFusedMapCache: true,
  tileInfo: {
    spatialReference: { latestWkid: 3857 },
    lods: [{ level: 0 }, { level: 1 }, { level: 16 }]
  }
};

const FEATURE_SERVER = {
  currentVersion: 10.51,
  serviceDescription: "Parcels",
  supportedQueryFormats: "JSON, geoJSON",
  spatialReference: { latestWkid: 3857 },
  layers: [
    { id: 0, name: "Skupina", subLayerIds: [1] },
    { id: 1, name: "Parcely", geometryType: "esriGeometryPolygon" }
  ]
};

function io(...responses: unknown[]): AdapterIo {
  const queue = [...responses];
  return {
    async text() {
      throw new Error("ArcGIS is read as JSON");
    },
    async json() {
      if (!queue.length) throw new Error("unexpected extra request");
      return queue.shift();
    }
  };
}

test("the service type in the path is an unmistakable match", () => {
  assert.equal(arcgisAdapter.detect(new URL("https://x.org/arcgis/rest/services/a/MapServer")), 1);
  assert.equal(arcgisAdapter.detect(new URL("https://x.org/a/FeatureServer/3")), 1);
  // The WMS façade on an ArcGIS service belongs to the WMS adapter.
  assert.equal(arcgisAdapter.detect(new URL("https://x.org/a/MapServer/WMSServer")), 0);
  assert.equal(arcgisAdapter.detect(new URL("https://x.org/tiles/1/2/3.png")), 0);
});

test("a pasted sublayer URL probes the service and remembers which layer it named", async () => {
  const url = new URL("https://x.org/arcgis/rest/services/a/FeatureServer/1?f=html");
  assert.equal(arcgisPastedSublayer(url), "1");
  const probe = await arcgisAdapter.probe(url, io(FEATURE_SERVER));
  // The probe URL's own parameters and the sublayer are stripped from the endpoint.
  assert.equal(probe.endpoint, "https://x.org/arcgis/rest/services/a/FeatureServer");
  assert.equal(probe.delivery, "features");
  assert.equal(probe.kind, "arcgis-featureserver");
  // A group layer cannot be queried for geometry, so it is not offered.
  assert.deepEqual(
    probe.sublayers.map((sublayer) => [sublayer.id, sublayer.selectable]),
    [
      ["0", false],
      ["1", true]
    ]
  );
  assert.equal(probe.extra?.geoJson, true);
});

test("an error body served with HTTP 200 is still an error", async () => {
  await assert.rejects(
    arcgisAdapter.probe(
      new URL("https://x.org/a/MapServer"),
      io({ error: { message: "Token Required" } })
    ),
    (error: SourceProbeError) => error.message === "Token Required"
  );
});

test("a rendering map service exports one image per tile", async () => {
  const probe = await arcgisAdapter.probe(new URL("https://x.org/a/MapServer"), io(MAP_SERVER));
  assert.equal(probe.delivery, "tiles");
  assert.equal(probe.extra?.cached, false);

  const manifest = arcgisAdapter.describe({ probe, layerId: "flood", sublayerIds: [] });
  const template = (manifest.source.type === "raster-tiles" && manifest.source.tileTemplate) || "";
  assert.ok(template.startsWith("https://x.org/a/MapServer/export?bbox={bbox-epsg-3857}&"));
  const query = new URLSearchParams(template.slice(template.indexOf("&") + 1));
  // Both layers, and `show:` so the service draws the selection rather than its own defaults —
  // `Q100` is `defaultVisibility: false`.
  assert.equal(query.get("layers"), "show:0,1");
  assert.equal(query.get("format"), "PNG32");
  assert.equal(query.get("transparent"), "true");
  assert.deepEqual(manifest.attribution, [{ label: "© VÚV TGM" }]);
  assert.equal(validateLayerManifestV2(manifest).valid, true);
});

test("a cached map service is read from its tiles, capped at the zoom it was built to", async () => {
  const probe = await arcgisAdapter.probe(
    new URL("https://x.org/a/MapServer"),
    io(CACHED_MAP_SERVER)
  );
  const manifest = arcgisAdapter.describe({ probe, layerId: "flood", sublayerIds: [] });
  // Row before column: ArcGIS orders its tile path the other way round from XYZ.
  assert.equal(
    manifest.source.type === "raster-tiles" ? manifest.source.tileTemplate : "",
    "https://x.org/a/MapServer/tile/{z}/{y}/{x}"
  );
  assert.equal(manifest.queryPolicy?.maxZoom, 16);
});

test("a map service without Web Mercator is refused rather than drawn skewed", async () => {
  const probe = await arcgisAdapter.probe(
    new URL("https://x.org/a/MapServer"),
    io({ ...MAP_SERVER, spatialReference: { wkid: 5514 } })
  );
  assert.throws(
    () => arcgisAdapter.tileTemplate!({ probe, layerId: "x", sublayerIds: [] }),
    /Web Mercator/
  );
});

test("features come back as GeoJSON when the service speaks it", async () => {
  const probe = await arcgisAdapter.probe(
    new URL("https://x.org/a/FeatureServer"),
    io(FEATURE_SERVER)
  );
  const collection = await arcgisAdapter.features!(
    { probe, layerId: "parcels", sublayerIds: ["1"] },
    [12, 48, 13, 49],
    io({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [12.5, 48.5] },
          properties: { id: "7", name: "Parcela 7" }
        }
      ],
      exceededTransferLimit: true
    })
  );
  assert.equal(collection.features.length, 1);
  assert.equal(collection.features[0]?.properties.layerId, "parcels");
  // Silent truncation is the failure mode of an ArcGIS query, so it has to be said out loud.
  assert.match(collection.notice ?? "", /jen část/);
});

test("an older service's Esri JSON is converted, polygons as outlines", async () => {
  const probe = await arcgisAdapter.probe(
    new URL("https://x.org/a/FeatureServer"),
    io({ ...FEATURE_SERVER, supportedQueryFormats: "JSON" })
  );
  assert.equal(probe.extra?.geoJson, false);

  const collection = await arcgisAdapter.features!(
    { probe, layerId: "parcels", sublayerIds: ["1"] },
    [12, 48, 13, 49],
    io({
      objectIdFieldName: "OBJECTID",
      displayFieldName: "NAZEV",
      features: [
        {
          attributes: { OBJECTID: 42, NAZEV: "Parcela 42" },
          geometry: {
            rings: [
              [
                [12.1, 48.1],
                [12.2, 48.1],
                [12.2, 48.2],
                [12.1, 48.1]
              ]
            ]
          }
        },
        { attributes: { OBJECTID: 43 }, geometry: { x: 12.5, y: 48.5 } },
        // No geometry at all: nothing to place on a map.
        { attributes: { OBJECTID: 44 } }
      ]
    })
  );

  assert.equal(collection.features.length, 2);
  const [ring, point] = collection.features;
  assert.equal(ring?.geometry.type, "LineString");
  assert.equal(ring?.properties.name, "Parcela 42");
  assert.equal(ring?.properties.id, "42");
  assert.equal(ring?.properties.category, "Parcely");
  assert.equal(point?.geometry.type, "Point");
  // No display field value: the object id is a better label than an empty one.
  assert.equal(point?.properties.name, "#43");
});

test("a feature service is described as a viewport query, not as tiles", async () => {
  const probe = await arcgisAdapter.probe(
    new URL("https://x.org/a/FeatureServer"),
    io(FEATURE_SERVER)
  );
  const manifest = arcgisAdapter.describe({
    probe,
    layerId: "parcels",
    sublayerIds: ["1"],
    category: "infrastructure"
  });
  assert.equal(manifest.source.type, "server-adapter");
  assert.equal(manifest.queryPolicy?.strategy, "viewport");
  assert.equal(manifest.category, "infrastructure");
  assert.equal(validateLayerManifestV2(manifest).valid, true);
  assert.throws(() => arcgisAdapter.tileTemplate!({ probe, layerId: "x", sublayerIds: ["1"] }));
});
