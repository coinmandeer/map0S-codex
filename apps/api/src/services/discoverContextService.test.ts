import assert from "node:assert/strict";
import test from "node:test";
import type { Guide } from "@mapos/layer-sdk";
import {
  createDiscoverContextService,
  discoverContextKey,
  giscoNutsLevelForZoom,
  latestEurostatGdpPerCapita,
  latestWikidataPopulation,
  normalizeGiscoLauCatalogue,
  normalizeGiscoRegionCatalogue,
  normalizeNominatimBoundary,
  normalizeNominatimRegion,
  resolveDiscoverRegion,
  type ResolvedDiscoverRegion
} from "./discoverService.js";

const region: ResolvedDiscoverRegion = {
  id: "nominatim:relation:123",
  name: "Plzeň",
  level: "locality",
  countryCode: "CZ",
  hierarchy: [
    { name: "Česko", level: "country" },
    { name: "Plzeňský kraj", level: "admin1" },
    { name: "Plzeň", level: "locality" }
  ]
};

const guide: Guide = {
  area: "Plzeň",
  lang: "cs",
  sourceId: "wikivoyage",
  attribution: "Wikivoyage contributors",
  url: "https://cs.wikivoyage.org/wiki/Plzeň",
  sections: [
    {
      id: "understand",
      title: "O místě",
      intro: "Citovatelný úvod.",
      items: []
    }
  ]
};

const input = { lng: 13.3775, lat: 49.7475, zoom: 12, lang: "cs" };

test("Nominatim address becomes a smallest-reliable breadcrumb without bbox geometry", () => {
  const result = normalizeNominatimRegion({
    osm_type: "relation",
    osm_id: 123,
    address: {
      country: "Česko",
      country_code: "cz",
      state: "Plzeňský kraj",
      county: "Plzeň-město",
      city: "Plzeň",
      suburb: "Bory"
    }
  });

  assert.equal(result?.name, "Bory");
  assert.equal(result?.level, "neighbourhood");
  assert.deepEqual(
    result?.hierarchy.map((item) => item.level),
    ["country", "admin1", "admin2", "locality", "neighbourhood"]
  );
  assert.equal("geometry" in (result ?? {}), false);
});

test("zoom-selected Nominatim hierarchy carries only a valid simplified polygon", () => {
  const polygon = {
    type: "Polygon" as const,
    coordinates: [
      [
        [12.1, 48.5],
        [18.9, 48.5],
        [18.9, 51.1],
        [12.1, 48.5]
      ]
    ]
  };
  const result = normalizeNominatimRegion(
    {
      osm_type: "relation",
      osm_id: 456,
      name: "Plzeňský kraj",
      addresstype: "state",
      address: {
        country: "Česko",
        country_code: "cz",
        state: "Plzeňský kraj",
        county: "Plzeň-město",
        city: "Plzeň",
        suburb: "Bory"
      },
      extratags: {
        population: "614640",
        "population:date": "2025-01-01",
        wikidata: "Q46070",
        "ref:nuts:3": "CZ032"
      },
      geojson: polygon
    },
    "admin1"
  );

  assert.equal(result?.name, "Plzeňský kraj");
  assert.deepEqual(
    result?.hierarchy.map((item) => item.level),
    ["country", "admin1"]
  );
  assert.deepEqual(result?.boundary?.geometry, polygon);
  assert.equal(result?.wikidataId, "Q46070");
  assert.equal(result?.nutsCode, "CZ032");
  assert.deepEqual(result?.populationSeed, { value: 614640, year: 2025 });
  assert.equal(
    normalizeNominatimBoundary({
      ...polygon,
      coordinates: [
        [
          [12.1, 48.5],
          [18.9, 48.5],
          [18.9, 51.1]
        ]
      ]
    }),
    null
  );
});

test("a parent address never inherits the returned district's identity or statistics", () => {
  const district = {
    osm_type: "relation",
    osm_id: 99,
    name: "Praha 1",
    addresstype: "city_district",
    address: { country: "Czechia", country_code: "cz", city: "Prague", city_district: "Praha 1" },
    extratags: { wikidata: "Q163405", population: "22967", "ref:nuts:3": "CZ010" },
    geojson: {
      type: "Polygon",
      coordinates: [
        [
          [14, 50],
          [15, 50],
          [15, 51],
          [14, 50]
        ]
      ]
    }
  };
  const parent = normalizeNominatimRegion(district, "locality")!;
  assert.equal(parent.name, "Prague");
  assert.match(parent.id, /^nominatim:hierarchy:/);
  assert.equal(parent.wikidataId, undefined);
  assert.equal(parent.populationSeed, undefined);
  assert.equal(parent.boundary, undefined);
  assert.equal(parent.nutsCode, undefined);
  const own = normalizeNominatimRegion(district, "neighbourhood")!;
  assert.equal(own.id, "nominatim:relation:99");
  assert.equal(own.wikidataId, "Q163405");
  assert.equal(own.populationSeed?.value, 22967);
  assert.ok(own.boundary);
  assert.equal(
    normalizeNominatimRegion({ ...district, osm_id: 100, name: "Praha 2" }, "locality")!.id,
    parent.id
  );
  assert.notEqual(
    normalizeNominatimRegion(
      { ...district, address: { ...district.address, country_code: "us" } },
      "locality"
    )!.id,
    parent.id
  );
});

test("matching localized names retain object metadata only at its own address level", () => {
  const city = {
    name: "Praha",
    namedetails: { "name:en": "Prague" },
    addresstype: "city",
    osm_type: "relation",
    osm_id: 1,
    address: { country: "Czechia", city: "Prague" },
    extratags: { wikidata: "Q1085" }
  };
  assert.equal(normalizeNominatimRegion(city, "locality")!.wikidataId, "Q1085");
  assert.equal(
    normalizeNominatimRegion({ ...city, addresstype: "country" }, "locality")!.wikidataId,
    undefined
  );
  assert.equal(
    normalizeNominatimRegion({ ...city, name: undefined, namedetails: undefined }, "locality")!
      .wikidataId,
    undefined
  );
});

test("reverse child is resolved to one matching parent without borrowing the child's data", async () => {
  const child = {
    name: "Praha 1",
    addresstype: "city_district",
    osm_type: "relation",
    osm_id: 99,
    address: { country: "Czechia", country_code: "cz", city: "Prague", city_district: "Praha 1" },
    extratags: { wikidata: "Q163405", population: "22967" }
  };
  const parent = {
    name: "Prague",
    addresstype: "city",
    osm_type: "relation",
    osm_id: 435514,
    address: { country: "Czechia", country_code: "cz", city: "Prague" },
    boundingbox: ["49.9", "50.3", "14.2", "14.8"],
    extratags: { wikidata: "Q1085" }
  };
  const calls: string[] = [];
  const io = (async (url: string) => {
    calls.push(url);
    return url.includes("/reverse?") ? child : [parent];
  }) as Parameters<typeof resolveDiscoverRegion>[2];
  const result = await resolveDiscoverRegion(
    { lng: 14.42, lat: 50.08, zoom: 12, lang: "en" },
    undefined,
    io
  );
  assert.equal(result?.wikidataId, "Q1085");
  assert.equal(result?.id, "nominatim:relation:435514");
  assert.equal(result?.populationSeed, undefined);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1]!).searchParams.get("countrycodes"), "cz");
  for (const candidates of [
    [parent, { ...parent, osm_id: 2 }],
    [{ ...parent, boundingbox: ["40", "41", "14", "15"] }],
    [{ ...parent, name: "Other", address: { ...parent.address, city: "Other" } }]
  ]) {
    const fallbackIo = (async (url: string) =>
      url.includes("/reverse?") ? child : candidates) as Parameters<
      typeof resolveDiscoverRegion
    >[2];
    const fallback = await resolveDiscoverRegion(
      { lng: 14.42, lat: 50.08, zoom: 12 },
      undefined,
      fallbackIo
    );
    assert.match(fallback!.id, /^nominatim:hierarchy:/);
    assert.equal(fallback?.wikidataId, undefined);
  }
});

test("latest Wikidata population keeps the newest dated non-deprecated statement", () => {
  const statement = (amount: string, year: number, rank = "normal") => ({
    rank,
    property: { id: "P1082" },
    value: { type: "value", content: { amount } },
    qualifiers: [
      {
        property: { id: "P585" },
        value: { type: "value", content: { time: `+${year}-01-01T00:00:00Z` } }
      }
    ]
  });
  assert.deepEqual(
    latestWikidataPopulation({
      P1082: [
        statement("+576635", 2016),
        statement("+614640", 2025, "preferred"),
        statement("+999999", 2026, "deprecated")
      ]
    }),
    { value: 614640, year: 2025 }
  );
  assert.equal(latestWikidataPopulation({ P1082: [] }), null);
});

test("Eurostat parser accepts exactly one filtered regional GDP cell with its year", () => {
  assert.deepEqual(
    latestEurostatGdpPerCapita({
      id: ["freq", "unit", "geo", "time"],
      size: [1, 1, 1, 1],
      value: { 0: 25300 },
      dimension: { time: { category: { index: { 2024: 0 } } } }
    }),
    { value: 25300, year: 2024 }
  );
  assert.equal(
    latestEurostatGdpPerCapita({
      id: ["geo", "time"],
      size: [2, 1],
      value: { 0: 25300, 1: 26000 },
      dimension: { time: { category: { index: { 2024: 0 } } } }
    }),
    null
  );
});

test("LAU catalogue offers municipalities at city zoom", () => {
  const geometry = {
    type: "Polygon",
    coordinates: [
      [
        [13.3, 49.7],
        [13.5, 49.7],
        [13.5, 49.8],
        [13.3, 49.8],
        [13.3, 49.7]
      ]
    ]
  };
  const catalogue = normalizeGiscoLauCatalogue({
    numberMatched: 2,
    features: [
      { properties: { gisco_id: "CZ_558371", lau_name: "Starý Plzenec" }, geometry },
      { properties: { gisco_id: "CZ_558834" }, geometry },
      { properties: { gisco_id: "not a code" }, geometry },
      { properties: { gisco_id: "CZ_999999", lau_name: "Bez geometrie" } }
    ]
  });

  assert.equal(catalogue?.nutsLevel, "lau");
  assert.equal(catalogue?.sourceId, "eurostat-gisco-lau-2024");
  assert.deepEqual(
    catalogue?.regions.map((region) => [region.code, region.name]),
    [
      ["CZ_558371", "Starý Plzenec"],
      ["CZ_558834", "CZ_558834"]
    ]
  );
});

test("GISCO catalogue exposes one zoom-selected NUTS level and drops the selected region", () => {
  assert.deepEqual([4, 5, 6, 7, 11].map(giscoNutsLevelForZoom), [0, 1, 2, 3, "lau"]);
  const geometry = {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [13.6, 49.5],
          [14.0, 49.5],
          [14.0, 49.9],
          [13.6, 49.9],
          [13.6, 49.5]
        ]
      ]
    ]
  };
  const catalogue = normalizeGiscoRegionCatalogue(
    {
      numberMatched: 24,
      features: [
        {
          properties: { nuts_id: "CZ032", levl_code: 3 },
          geometry
        },
        {
          properties: { nuts_id: "CZ041", levl_code: 3 },
          geometry
        },
        {
          properties: { nuts_id: "CZ03", levl_code: 2 },
          geometry
        }
      ]
    },
    3,
    { CZ041: "Karlovarský kraj" },
    "CZ032"
  );

  assert.equal(catalogue?.nutsLevel, 3);
  assert.equal(catalogue?.truncated, true);
  assert.deepEqual(
    catalogue?.regions.map(({ code, name }) => ({ code, name })),
    [{ code: "CZ041", name: "Karlovarský kraj" }]
  );
});

test("a sourced region polygon becomes the context boundary without changing citations", async () => {
  const geometry = {
    type: "Polygon" as const,
    coordinates: [
      [
        [13.2, 49.6],
        [13.6, 49.6],
        [13.6, 49.9],
        [13.2, 49.6]
      ]
    ]
  };
  const service = createDiscoverContextService({
    resolveRegion: async () => ({
      ...region,
      boundary: { geometry, sourceId: "nominatim-osm" }
    }),
    resolveGuide: async () => null,
    now: () => Date.parse("2026-09-01T12:00:00.000Z")
  });

  const context = await service.get(input);
  assert.equal(context.boundary.status, "ready");
  assert.deepEqual(context.boundary.geometry, geometry);
  assert.equal(context.boundary.sourceId, "nominatim-osm");
  assert.equal("boundary" in (context.region ?? {}), false);
  assert.deepEqual(
    context.sources.map((source) => source.id),
    ["nominatim-osm"]
  );
});

test("a generic sourced statistic carries scope, year, uncertainty and its own citation", async () => {
  const service = createDiscoverContextService({
    resolveRegion: async () => region,
    resolveGuide: async () => null,
    resolveStatistics: async () => [
      {
        id: "population",
        label: "Počet obyvatel",
        value: 614640,
        unit: "people",
        scope: { regionId: region.id, regionName: region.name, level: region.level },
        year: 2025,
        uncertainty: "reported-community-data",
        uncertaintyLabel: "Otevřený publikovaný údaj.",
        sourceIds: ["wikidata:Q46070"]
      },
      {
        id: "gdp-per-capita",
        label: "Regionální HDP na obyvatele",
        value: 25300,
        unit: "eur-per-person",
        scope: {
          regionId: region.id,
          regionName: region.name,
          level: region.level,
          geographicCode: "CZ032"
        },
        year: 2024,
        uncertainty: "regional-aggregate",
        uncertaintyLabel: "Regionální agregát.",
        sourceIds: ["eurostat:nama_10r_3gdp"]
      }
    ],
    now: () => Date.parse("2026-09-01T12:00:00.000Z")
  });

  const context = await service.get(input);
  assert.equal(context.statistics[0]?.value, 614640);
  assert.equal(context.statistics[0]?.year, 2025);
  assert.equal(context.statistics[0]?.scope.regionName, "Plzeň");
  assert.equal(context.statistics[0]?.uncertainty, "reported-community-data");
  assert.deepEqual(
    context.blocks.find((block) => block.id === "statistics"),
    {
      id: "statistics",
      status: "ready",
      sourceIds: ["wikidata:Q46070", "eurostat:nama_10r_3gdp"]
    }
  );
  assert.equal(
    context.sources.find((source) => source.id === "wikidata:Q46070")?.license,
    "CC0 1.0"
  );
  assert.equal(
    context.sources.find((source) => source.id === "eurostat:nama_10r_3gdp")?.label,
    "Eurostat · nama_10r_3gdp"
  );
});

test("a new statistic capability registers independently and reaches the generic response", async () => {
  const service = createDiscoverContextService({
    resolveRegion: async () => region,
    resolveGuide: async () => null,
    capabilities: [
      {
        id: "median-age",
        label: "Demografie rozšíření",
        kind: "statistics",
        resolve: async () => ({
          kind: "statistics",
          value: [
            {
              id: "median-age",
              label: "Medián věku",
              value: 43.2,
              unit: "years",
              scope: { regionId: region.id, regionName: region.name, level: region.level },
              year: 2025,
              uncertainty: "regional-aggregate",
              uncertaintyLabel: "Testovací regionální agregát.",
              sourceIds: ["wikidata:Q46070"]
            }
          ]
        })
      }
    ],
    now: () => Date.parse("2026-09-01T12:00:00.000Z")
  });

  const context = await service.get(input);
  assert.equal(context.statistics[0]?.id, "median-age");
  assert.deepEqual(context.capabilities, [
    {
      id: "median-age",
      label: "Demografie rozšíření",
      kind: "statistics",
      status: "ready",
      sourceIds: ["wikidata:Q46070"]
    }
  ]);
});

test("a regional catalogue keeps multiple polygons in one generic sourced context block", async () => {
  const geometry = {
    type: "Polygon" as const,
    coordinates: [
      [
        [13.6, 49.5],
        [14.0, 49.5],
        [14.0, 49.9],
        [13.6, 49.9],
        [13.6, 49.5]
      ]
    ]
  };
  const service = createDiscoverContextService({
    resolveRegion: async () => region,
    resolveGuide: async () => null,
    resolveRegionCatalogue: async () => ({
      nutsLevel: 3,
      truncated: false,
      sourceId: "eurostat-gisco-nuts-2024",
      regions: [
        {
          id: "nuts:CZ041",
          code: "CZ041",
          name: "Karlovarský kraj",
          nutsLevel: 3,
          geometry,
          sourceId: "eurostat-gisco-nuts-2024"
        }
      ]
    }),
    now: () => Date.parse("2026-09-01T12:00:00.000Z")
  });

  const context = await service.get(input);
  assert.equal(context.regionCatalogue?.regions[0]?.name, "Karlovarský kraj");
  assert.deepEqual(context.blocks.find((block) => block.id === "region")?.sourceIds, [
    "nominatim-osm",
    "eurostat-gisco-nuts-2024"
  ]);
  assert.equal(
    context.sources.find((source) => source.id === "eurostat-gisco-nuts-2024")?.label,
    "Eurostat GISCO · NUTS 2024"
  );
});

test("structured region and guide stay the data-saving default and carry citations", async () => {
  const calls: string[] = [];
  const service = createDiscoverContextService({
    resolveRegion: async () => {
      calls.push("region");
      return region;
    },
    resolveGuide: async () => {
      calls.push("guide");
      return guide;
    },
    synthesize: async () => {
      calls.push("model");
      return { text: "Should not be used", model: "test" };
    },
    now: () => Date.parse("2026-09-01T12:00:00.000Z")
  });

  const context = await service.get(input);
  assert.deepEqual(calls, ["region", "guide"]);
  assert.equal(context.synthesis?.kind, "structured");
  assert.equal(context.synthesis?.text, "Citovatelný úvod.");
  assert.deepEqual(
    context.sources.map((source) => source.id),
    ["nominatim-osm", "guide:wikivoyage"]
  );
  assert.equal(context.boundary.geometry, null);
  assert.equal(context.boundary.status, "dataset-required");
});

test("explicit enrichment synthesizes only after structured sources and keeps their citations", async () => {
  const calls: string[] = [];
  const service = createDiscoverContextService({
    resolveRegion: async () => {
      calls.push("region");
      return region;
    },
    resolveGuide: async () => {
      calls.push("guide");
      return guide;
    },
    synthesize: async () => {
      calls.push("model");
      return {
        text: "Modelové shrnutí nad dodaným průvodcem.",
        model: "stub",
        sourceIds: ["nominatim-osm", "guide:wikivoyage", "invented"]
      };
    }
  });

  const context = await service.get({ ...input, allowModelFallback: true });
  assert.deepEqual(calls, ["region", "guide", "model"]);
  assert.equal(context.synthesis?.kind, "model");
  assert.match(context.synthesis?.label ?? "", /ze zdrojů/);
  assert.deepEqual(context.synthesis?.sourceIds, ["nominatim-osm", "guide:wikivoyage"]);
});

test("optional model fallback runs only after structured attempts and stays labelled", async () => {
  const calls: string[] = [];
  const service = createDiscoverContextService({
    resolveRegion: async () => {
      calls.push("region");
      return null;
    },
    resolveGuide: async () => {
      calls.push("guide");
      return null;
    },
    synthesize: async () => {
      calls.push("model");
      return { text: "Obecný modelový návrh.", model: "stub", sourceIds: ["invented"] };
    }
  });

  const context = await service.get({ ...input, allowModelFallback: true });
  assert.deepEqual(calls, ["region", "guide", "model"]);
  assert.equal(context.synthesis?.kind, "model");
  assert.match(context.synthesis?.label ?? "", /bez ověřených/);
  assert.deepEqual(context.synthesis?.sourceIds, []);
});

test("cache key absorbs small viewport jitter and requests are deduplicated", async () => {
  assert.equal(
    discoverContextKey({ ...input, lng: 13.3771, lat: 49.7471 }),
    discoverContextKey({ ...input, lng: 13.37714, lat: 49.74714 })
  );

  let resolveCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = createDiscoverContextService({
    resolveRegion: async () => {
      resolveCalls += 1;
      await gate;
      return region;
    },
    resolveGuide: async () => null,
    now: () => Date.parse("2026-09-01T12:00:00.000Z")
  });
  const first = service.get(input);
  const duplicate = service.get(input);
  release();
  await Promise.all([first, duplicate]);
  assert.equal(resolveCalls, 1);

  const cached = await service.get(input);
  assert.equal(cached.cache.hit, true);
  assert.equal(resolveCalls, 1);
});

test("selected immutable area bypasses reverse geocoding and partitions the context cache", async () => {
  let reverseCalls = 0;
  const service = createDiscoverContextService({
    resolveRegion: async () => {
      reverseCalls++;
      return region;
    },
    resolveGuide: async () => null,
    capabilities: []
  });
  const area = {
    id: '["gisco-lau-es","ES","lau","ES_43148"]',
    revision: "a".repeat(64),
    source: "gisco-lau-es",
    country: "ES",
    level: "lau" as const,
    code: "ES_43148",
    name: "Tarragona",
    bbox: [1, 41, 1.5, 41.5] as [number, number, number, number]
  };
  const result = await service.get({ ...input, area });
  assert.equal(result.region?.id, area.id);
  assert.equal(result.region?.name, "Tarragona");
  assert.equal(reverseCalls, 0);
  assert.notEqual(
    discoverContextKey({ ...input, area }),
    discoverContextKey({ ...input, area: { ...area, revision: "b".repeat(64) } })
  );
  assert.notEqual(discoverContextKey({ ...input, area }), discoverContextKey(input));
});
