import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { __setUpstreamTestDependencies, __resetUpstreamCache } from "../utils/upstream.js";
import { defaultGeoUnitSourceIds, GEO_UNIT_SOURCES, geoUnitSource } from "./geoUnitSources.js";
import {
  featuresOf,
  fetchGeoUnitCollection,
  importGeoUnitSource,
  type GeoUnitRow
} from "./geoUnitsImport.js";

const POLYGON = {
  type: "Polygon",
  coordinates: [
    [
      [12, 48],
      [13, 48],
      [13, 49],
      [12, 48]
    ]
  ]
};

test("GitHub LFS geometry is fetched from the direct host and checked against its checksum", async () => {
  const body = JSON.stringify({ type: "FeatureCollection", features: [{ geometry: POLYGON }] });
  const digest = createHash("sha256").update(body).digest("hex");
  const calls: string[] = [];
  __setUpstreamTestDependencies({
    resolveHost: async () => ["93.184.216.34"],
    request: async (url) => {
      calls.push(String(url));
      return new Response(
        calls.length === 1
          ? `version https://git-lfs.github.com/spec/v1\noid sha256:${digest}\nsize ${Buffer.byteLength(body)}\n`
          : body,
        { headers: { "content-type": "text/plain" } }
      );
    }
  });
  try {
    const result = await fetchGeoUnitCollection(
      "https://github.com/wmgeolab/geoBoundaries/raw/commit/file.geojson",
      geoUnitSource("gb-cz-adm1")!
    );
    assert.deepEqual(result, JSON.parse(body));
    assert.deepEqual(calls, [
      "https://raw.githubusercontent.com/wmgeolab/geoBoundaries/commit/file.geojson",
      "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/commit/file.geojson"
    ]);
  } finally {
    __resetUpstreamCache();
  }
});

function collector() {
  const rows: GeoUnitRow[] = [];
  return {
    rows,
    persist: async (batch: readonly GeoUnitRow[]) => {
      rows.push(...batch);
    }
  };
}

test("a GISCO NUTS 3 feature becomes a row whose parent is the NUTS 2 above it", async () => {
  const source = geoUnitSource("gisco-nuts3")!;
  const sink = collector();
  const result = await importGeoUnitSource(source, {
    persist: sink.persist,
    fetchCollection: async () => ({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            NUTS_ID: "CZ032",
            LEVL_CODE: 3,
            CNTR_CODE: "CZ",
            NAME_LATN: "Plzeňský kraj",
            NUTS_NAME: "Plzeňský kraj"
          },
          geometry: POLYGON
        }
      ]
    })
  });

  assert.deepEqual(
    { read: result.read, written: result.written, skipped: result.skipped },
    { read: 1, written: 1, skipped: 0 }
  );
  const row = sink.rows[0]!;
  assert.equal(row.level, "nuts3");
  assert.equal(row.code, "CZ032");
  assert.equal(row.parentCode, "CZ03");
  assert.equal(row.country, "CZ");
  assert.equal(row.name, "Plzeňský kraj");
  assert.equal(row.edition, "2024");
});

test("a country level NUTS row has no parent to point at", async () => {
  const sink = collector();
  await importGeoUnitSource(geoUnitSource("gisco-nuts0")!, {
    persist: sink.persist,
    fetchCollection: async () => ({
      features: [
        {
          properties: { NUTS_ID: "CZ", LEVL_CODE: 0, CNTR_CODE: "CZ", NAME_LATN: "Česko" },
          geometry: POLYGON
        }
      ]
    })
  });
  assert.equal(sink.rows[0]!.parentCode, null);
});

test("Natural Earth's -99 placeholder falls back to the three-letter code", async () => {
  const sink = collector();
  await importGeoUnitSource(geoUnitSource("natural-earth-countries")!, {
    persist: sink.persist,
    fetchCollection: async () => ({
      features: [
        {
          properties: { ISO_A2_EH: "FR", NAME_EN: "France" },
          geometry: POLYGON
        },
        {
          // Kosovo and other disputed entries ship as -99, which is not a code to store.
          properties: { ISO_A2_EH: "-99", ADM0_A3: "KOS", NAME_EN: "Kosovo" },
          geometry: POLYGON
        }
      ]
    })
  });
  assert.deepEqual(
    sink.rows.map((row) => [row.code, row.country]),
    [
      ["FR", "FR"],
      ["KOS", null]
    ]
  );
});

test("features without a drawable ring are skipped rather than stored", async () => {
  const sink = collector();
  const result = await importGeoUnitSource(geoUnitSource("gisco-nuts2")!, {
    persist: sink.persist,
    fetchCollection: async () => ({
      features: [
        {
          properties: { NUTS_ID: "CZ03", LEVL_CODE: 2 },
          geometry: { type: "Point", coordinates: [12, 48] }
        },
        {
          properties: { NUTS_ID: "CZ04", LEVL_CODE: 2 },
          geometry: { type: "Polygon", coordinates: [] }
        },
        { properties: { LEVL_CODE: 2 }, geometry: POLYGON },
        { properties: { NUTS_ID: "CZ05", LEVL_CODE: 2 }, geometry: POLYGON }
      ]
    })
  });
  assert.equal(result.read, 4);
  assert.equal(result.skipped, 3);
  assert.deepEqual(
    sink.rows.map((row) => row.code),
    ["CZ05"]
  );
});

test("a code repeated inside one file is reported instead of passing unnoticed", async () => {
  const sink = collector();
  const result = await importGeoUnitSource(geoUnitSource("gisco-nuts1")!, {
    persist: sink.persist,
    fetchCollection: async () => ({
      features: [
        { properties: { NUTS_ID: "CZ0", LEVL_CODE: 1 }, geometry: POLYGON },
        { properties: { NUTS_ID: "CZ0", LEVL_CODE: 1 }, geometry: POLYGON }
      ]
    })
  });
  assert.equal(result.duplicates, 1);
});

test("geoBoundaries is asked per country, and the metadata step picks the simplified file", async () => {
  const source = geoUnitSource("geoboundaries-adm1")!;
  const requested: string[] = [];
  const sink = collector();
  await importGeoUnitSource(
    { ...source, countries: ["USA"] },
    {
      persist: sink.persist,
      fetchCollection: async (url) => {
        requested.push(url);
        if (url.includes("/api/")) {
          return [
            {
              gjDownloadURL: "https://example.org/full.geojson",
              simplifiedGeometryGeoJSON: "https://example.org/simplified.geojson"
            }
          ];
        }
        return {
          features: [
            {
              properties: {
                shapeISO: "US-CA",
                shapeName: "California",
                shapeGroup: "USA",
                shapeID: "USA-ADM1-3"
              },
              geometry: POLYGON
            }
          ]
        };
      }
    }
  );

  assert.deepEqual(requested, [
    "https://www.geoboundaries.org/api/current/gbOpen/USA/ADM1/",
    "https://example.org/simplified.geojson"
  ]);
  assert.equal(sink.rows[0]!.code, "USA-ADM1-3");
  assert.equal(sink.rows[0]!.country, "USA");
});

test("country-level shapeISO never collapses distinct administrative regions", async () => {
  const source = geoUnitSource("gb-es-adm1")!;
  const rows = ["Canarias", "Melilla", "Ceuta"].map((name, index) =>
    source.normalize(
      {
        properties: {
          shapeISO: "ESP",
          shapeID: `25490228B${index}`,
          shapeName: name,
          shapeGroup: "ESP"
        },
        geometry: POLYGON
      },
      source
    )!
  );
  assert.equal(new Set(rows.map((row) => row.code)).size, 3);
  assert.deepEqual(
    rows.map((row) => row.name),
    ["Canarias", "Melilla", "Ceuta"]
  );
  assert.equal(
    source.normalize({ properties: { shapeISO: "ESP" }, geometry: POLYGON }, source),
    null
  );
});

test("a batch larger than the flush size is written in parts, losing nothing", async () => {
  const batches: number[] = [];
  const features = Array.from({ length: 450 }, (_unused, index) => ({
    properties: { NUTS_ID: `XX${String(index).padStart(3, "0")}`, LEVL_CODE: 3 },
    geometry: POLYGON
  }));
  const result = await importGeoUnitSource(geoUnitSource("gisco-nuts3")!, {
    persist: async (rows) => {
      batches.push(rows.length);
    },
    fetchCollection: async () => ({ features })
  });
  assert.equal(result.written, 450);
  assert.deepEqual(batches, [200, 200, 50]);
});

test("featuresOf tolerates whatever a service returns instead of a collection", () => {
  assert.deepEqual(featuresOf(null), []);
  assert.deepEqual(featuresOf({ features: "nope" }), []);
  assert.deepEqual(featuresOf({ features: [] }), []);
});

test("every catalogue entry declares a licence and a stable provider slug", () => {
  for (const source of GEO_UNIT_SOURCES) {
    assert.ok(source.license, `${source.id} has no licence`);
    assert.ok(source.attribution, `${source.id} has no attribution`);
    assert.match(source.providerId, /^[a-z0-9-]+$/, `${source.id} has a display-name provider`);
    assert.ok(source.url || source.countries, `${source.id} has nothing to fetch`);
  }
});

test("a bare run skips the sources that are too large to import by accident", () => {
  const defaults = defaultGeoUnitSourceIds();
  assert.ok(defaults.includes("gisco-nuts3"));
  assert.ok(
    !defaults.includes("gisco-lau"),
    "the municipality set is a hundred megabytes; asking for it has to be deliberate"
  );
  // It is still in the catalogue, so naming it on the command line works.
  assert.ok(GEO_UNIT_SOURCES.some((source) => source.id === "gisco-lau"));
});

test("a GISCO LAU feature keeps the prefixed id and does not guess a NUTS parent", async () => {
  const source = geoUnitSource("gisco-lau")!;
  const row = source.normalize(
    {
      type: "Feature",
      properties: {
        GISCO_ID: "CZ_554782",
        LAU_ID: "554782",
        LAU_NAME: "Praha",
        CNTR_CODE: "CZ",
        AREA_KM2: 496.2
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [14, 50],
            [14.1, 50],
            [14.1, 50.1],
            [14, 50]
          ]
        ]
      }
    },
    source
  );

  assert.equal(row!.code, "CZ_554782");
  assert.equal(row!.level, "lau");
  assert.equal(row!.country, "CZ");
  assert.equal(row!.parentCode, null);
  assert.equal(row!.areaKm2, 496.2);
});

test("European admin imports have independent scope and ISO2 countries without invented parents", () => {
  const source = geoUnitSource("gb-cz-adm2")!;
  const row = source.normalize(
    {
      properties: { shapeID: "district", shapeName: "District", shapeGroup: "CZE" },
      geometry: POLYGON
    },
    source
  )!;
  assert.equal(row.country, "CZ");
  assert.equal(row.parentCode, null);
  assert.equal(row.sourceId, "gb-cz-adm2");
  assert.notEqual(row.sourceId, geoUnitSource("gb-de-adm2")!.providerId);
});

test("a missing country download fails instead of silently publishing incomplete coverage", async () => {
  const source = geoUnitSource("gb-cz-adm1")!;
  await assert.rejects(
    importGeoUnitSource(source, { persist: async () => {}, fetchCollection: async () => ({}) }),
    /missing/
  );
});
