import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildUserLayerPackage,
  packageAsGeoJson,
  parseUserLayerImport,
  type LayerTransferProvenance
} from "./userLayerPackage";

const layer = {
  id: "layer-trip",
  name: "Výlet",
  color: "#10b981",
  isPublic: 1,
  slug: "vylet"
};

const provenance: LayerTransferProvenance[] = [
  {
    source: "osm",
    sourceRef: "node/123",
    attribution: "© OpenStreetMap přispěvatelé",
    license: "ODbL-1.0",
    capturedAt: "2026-09-01T08:00:00.000Z"
  }
];

describe("user layer import/export", () => {
  it("round-trips a MapOS package without losing provenance", () => {
    const exported = buildUserLayerPackage(
      layer,
      [
        {
          id: "pin-1",
          name: "Vyhlídka",
          description: "Nad údolím",
          lng: 14.4,
          lat: 50.1,
          tags: ["výlet"],
          kind: "place",
          properties: { difficulty: "easy", maposProvenance: provenance }
        }
      ],
      () => new Date("2026-09-01T10:00:00.000Z")
    );
    const preview = parseUserLayerImport(JSON.stringify(exported), "vylet.mapos.json");
    assert.equal(preview.format, "mapos-package");
    assert.equal(preview.requestedVisibility, "public");
    assert.deepEqual(preview.features[0]?.properties.maposProvenance, provenance);

    const reexported = buildUserLayerPackage(
      { ...layer, id: "imported-layer" },
      preview.features.map((feature, index) => ({
        id: `imported-${index}`,
        ...feature
      })),
      () => new Date("2026-09-01T11:00:00.000Z")
    );
    assert.deepEqual(reexported.data.features[0]?.properties.maposProvenance, provenance);
    assert.equal(reexported.data.features[0]?.properties.custom.difficulty, "easy");
  });

  it("imports GeoJSON privately and records synthetic provenance", () => {
    const preview = parseUserLayerImport(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "external-1",
            geometry: { type: "Point", coordinates: [13.37, 49.75] },
            properties: { name: "Bod", category: "museum" }
          }
        ]
      }),
      "muzea.geojson"
    );
    assert.equal(preview.format, "geojson");
    assert.equal(preview.requestedVisibility, "private");
    assert.equal(preview.name, "muzea");
    assert.deepEqual(preview.features[0]?.properties.maposProvenance, [
      { source: "geojson-import", sourceRef: "external-1" }
    ]);
  });

  it("imports quoted CSV and requires lng/lat columns", () => {
    const preview = parseUserLayerImport(
      'name,lng,lat,description,source,sourceRef,license\n"Bar, centrum",14.42,50.08,"Noční podnik",curator,row-1,CC-BY-4.0',
      "bary.csv"
    );
    assert.equal(preview.features[0]?.name, "Bar, centrum");
    assert.deepEqual(preview.features[0]?.properties.maposProvenance, [
      { source: "curator", sourceRef: "row-1", license: "CC-BY-4.0" }
    ]);
    assert.throws(() => parseUserLayerImport("name,x,y\nBod,1,2", "bad.csv"), /lng a lat/);
  });

  it("exports a standalone GeoJSON representation", () => {
    const exported = buildUserLayerPackage(layer, []);
    assert.deepEqual(JSON.parse(packageAsGeoJson(exported)), {
      type: "FeatureCollection",
      features: []
    });
  });
});
