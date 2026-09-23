import assert from "node:assert/strict";
import test from "node:test";
process.env.MAPOS_ALLOW_NONCOMMERCIAL_DATA = "1";
import { statDataset } from "@mapos/adapter-sdk";
import { isThemeManifestV2 } from "@mapos/layer-sdk";
import {
  classBreaks,
  listThemes,
  themeMetadata,
  themeSources,
  themeTile,
  themeUnit,
  type ThemeQueries,
  type ThemeTileRequest
} from "./themeService.js";
import { geoLevelForZoom } from "./themeRegistry.js";

function queries(overrides: Partial<ThemeQueries> = {}): ThemeQueries {
  return {
    periods: async () => ["2021", "2022", "2023"],
    quantiles: async () => [0, 100, 200, 400, 800, 1600],
    tile: async () => new Uint8Array([1, 2, 3]),
    hasGeoUnits: async () => true,
    coverage: async () => [],
    unit: async () => ({ name: "Jihočeský kraj", value: 690.5, rank: 3, of: 14, series: [] }),
    ...overrides
  };
}

test("metadata offers the newest period first and honours a valid request", async () => {
  const latest = await themeMetadata("crime", undefined, queries());
  assert.deepEqual(latest!.periods, ["2023", "2022", "2021"]);
  assert.equal(latest!.period, "2023");

  const asked = await themeMetadata("crime", "2022", queries());
  assert.equal(asked!.period, "2022");

  // An explicitly requested missing year must never borrow values from another year.
  const bogus = await themeMetadata("crime", "1999", queries());
  assert.equal(bogus!.period, null);
});

test("metadata names every source with its licence, so the popover needs no second request", async () => {
  const metadata = await themeMetadata("population", undefined, queries());
  assert.deepEqual(
    metadata!.sources.slice(0, 2).map((source) => [source.datasetId, source.role, source.geoLevel]),
    [
      ["eurostat-demo-r-pjanaggr3", "primary", "nuts3"],
      ["worldbank-sp-pop-totl", "detail", "country"]
    ]
  );
  for (const source of metadata!.sources) {
    assert.ok(source.license && source.attribution && source.documentationUrl);
  }
});

test("a theme with nothing imported reports itself as not ready", async () => {
  const empty = await themeMetadata("crime", undefined, queries({ periods: async () => [] }));
  assert.equal(empty!.ready, false);
  assert.equal(empty!.period, null);
  assert.deepEqual(empty!.breaks, []);

  const noBoundaries = await themeMetadata(
    "crime",
    undefined,
    queries({ hasGeoUnits: async () => false })
  );
  assert.equal(noBoundaries!.ready, false);
});

test("an unknown theme is absent rather than empty", async () => {
  assert.equal(await themeMetadata("nope", undefined, queries()), null);
});

test("the disclosure travels with the theme that needs it", async () => {
  const crime = await themeMetadata("crime", undefined, queries());
  assert.match(crime!.disclosure ?? "", /counts as an offence/);
  const population = await themeMetadata("population", undefined, queries());
  assert.equal(population!.disclosure, undefined);
});

test("a theme reads in the language it was asked for, and in English by default", async () => {
  const english = await themeMetadata("crime", undefined, queries());
  assert.equal(english!.name, "Intentional homicide");
  assert.equal(english!.unit, "offences per 100 000 people");

  const czech = await themeMetadata("crime", undefined, queries(), [], "cs");
  assert.equal(czech!.name, "Úmyslná zabití");
  assert.match(czech!.disclosure ?? "", /definice trestných činů/);

  // A language nobody translated the theme into is not an error; it reads in English.
  const german = await themeMetadata("crime", undefined, queries(), [], "de");
  assert.equal(german!.name, "Intentional homicide");
});

test("five classes come out of four cuts, hot ramp when higher is worse", () => {
  const bad = classBreaks([0, 100, 200, 400, 800, 1600], true);
  assert.equal(bad.length, 5);
  assert.deepEqual(
    bad.map((entry) => [entry.from, entry.to]),
    [
      [0, 100],
      [100, 200],
      [200, 400],
      [400, 800],
      [800, 1600]
    ]
  );
  assert.equal(bad[0]!.color, "#ffffb2");
  assert.equal(bad[4]!.color, "#bd0026");
  assert.notEqual(classBreaks([0, 1, 2, 3, 4, 5], false)[0]!.color, bad[0]!.color);
});

test("quantiles that coincide collapse instead of producing empty classes", () => {
  // A count series with many zeroes puts several cuts on the same value.
  const breaks = classBreaks([0, 0, 0, 5, 20, 90], true);
  assert.deepEqual(
    breaks.map((entry) => [entry.from, entry.to]),
    [
      [0, 5],
      [5, 20],
      [20, 90]
    ]
  );
});

test("a constant measured distribution has a single class", () => {
  assert.deepEqual(classBreaks([], true), []);
  assert.deepEqual(classBreaks([7], true), []);
  assert.deepEqual(
    classBreaks([7, 7, 7], true).map((b) => [b.from, b.to]),
    [[7, 7]]
  );
});

test("zoom picks the level that is readable at that scale", () => {
  assert.equal(geoLevelForZoom(2), "country");
  assert.equal(geoLevelForZoom(4), "nuts1");
  assert.equal(geoLevelForZoom(5), "nuts2");
  assert.equal(geoLevelForZoom(9), "nuts3");
});

test("a tile request resolves to the dataset published at that zoom's level", async () => {
  const seen: ThemeTileRequest[] = [];
  const spy = queries({
    tile: async (request) => {
      seen.push(request);
      return new Uint8Array([9]);
    }
  });

  // Zoomed out over the world, population is answered by the World Bank country series.
  await themeTile("population", 2, 1, 1, undefined, spy);
  // Zoomed in, by the imported municipal series.
  await themeTile("population", 9, 275, 176, undefined, spy);

  assert.deepEqual(
    seen.map((request) => [request.datasetId, request.geoLevel]),
    [
      ["worldbank-sp-pop-totl", "country"],
      ["lau-population-2024", "lau"]
    ]
  );
});

test("a theme published at one level only still draws when zoomed past it", async () => {
  const seen: ThemeTileRequest[] = [];
  await themeTile(
    "accidents",
    11,
    1100,
    700,
    undefined,
    queries({
      tile: async (request) => {
        seen.push(request);
        return new Uint8Array([1]);
      }
    })
  );
  assert.deepEqual(
    seen.map((request) => request.geoLevel),
    ["nuts2"]
  );
});

test("the requested period reaches the tile query, and an unavailable year is empty", async () => {
  const seen: string[] = [];
  const spy = queries({
    tile: async (request) => {
      seen.push(request.period);
      return new Uint8Array([1]);
    }
  });
  await themeTile("crime", 7, 68, 44, "2022", spy);
  await themeTile("crime", 7, 68, 44, "1999", spy);
  assert.deepEqual(seen, ["2022"]);
});

test("a theme whose sources have not landed yet serves no tile", async () => {
  assert.equal(await themeTile("nope", 7, 68, 44, undefined, queries()), null);
  assert.equal(
    await themeTile("crime", 7, 68, 44, undefined, queries({ periods: async () => [] })),
    null
  );
});

test("every registered theme has an icon and a unit for its legend", () => {
  for (const entry of listThemes()) {
    assert.match(entry.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(entry.icon, `${entry.id} has no icon`);
    assert.ok(entry.unit, `${entry.id} has no unit`);
  }
});

test("every registered theme is a manifest the schema accepts", () => {
  for (const entry of listThemes()) {
    assert.equal(isThemeManifestV2(entry), true, `${entry.id} is not a theme manifest`);
    for (const source of entry.sources) {
      assert.ok(
        statDataset(source.datasetId),
        `${entry.id} points at ${source.datasetId}, which is not in the dataset catalogue`
      );
    }
  }
});

test("sources are ordered by how much of the view they answer for, empties last", async () => {
  const sources = await themeSources(
    "population",
    [12, 48, 19, 51],
    queries({
      coverage: async () => [
        {
          sourceId: "worldbank-sp-pop-totl",
          geoLevel: "country",
          periodFrom: "1960",
          periodTo: "2023",
          units: 3,
          share: 0.4
        },
        {
          sourceId: "eurostat-demo-r-pjanaggr3",
          geoLevel: "nuts3",
          periodFrom: "2014",
          periodTo: "2023",
          units: 14,
          share: 0.92
        }
      ]
    })
  );

  assert.deepEqual(
    sources.slice(0, 2).map((source) => [source.datasetId, source.share]),
    [
      ["eurostat-demo-r-pjanaggr3", 0.92],
      ["worldbank-sp-pop-totl", 0.4]
    ]
  );
  assert.equal(sources[0]!.attribution, "Eurostat");
});

test("a source with no coverage stays in the list, described as covering nothing", async () => {
  const sources = await themeSources("population", [12, 48, 19, 51], queries());
  assert.equal(sources.length, listThemes().find((t) => t.id === "population")!.sources.length);
  assert.ok(sources.every((s) => s.share === null));
});

test("switching a source off removes it from the tile and from the classification", async () => {
  const seen: ThemeTileRequest[] = [];
  const spy = queries({
    tile: async (request) => {
      seen.push(request);
      return new Uint8Array([1]);
    }
  });

  // Zoom 2 would normally be answered by the World Bank country series.
  await themeTile("population", 2, 1, 1, undefined, spy, ["worldbank-sp-pop-totl"]);
  assert.deepEqual(
    seen.map((request) => request.datasetId),
    ["eurostat-demo-r-pjanaggr3-country"]
  );

  const metadata = await themeMetadata("population", undefined, queries(), [
    "worldbank-sp-pop-totl"
  ]);
  assert.ok(
    metadata!.sources.some((s) => s.datasetId === "worldbank-sp-pop-totl"),
    "Excluded sources stay available to re-enable"
  );
});

test("switching every source off draws nothing rather than falling back to one", async () => {
  const tile = await themeTile("crime", 7, 68, 44, undefined, queries(), [
    "eurostat-crim-gen-reg",
    "eurostat-crim-gen-reg-country"
  ]);
  assert.equal(tile, null);
});

test("a clicked territory is answered by the series published at its own level", async () => {
  const seen: Array<{ datasetId: string; geoLevel: string }> = [];
  const spy = queries({
    unit: async (request) => {
      seen.push({ datasetId: request.datasetId, geoLevel: request.geoLevel });
      return { name: "Praha", value: 1, rank: 1, of: 14, series: [] };
    }
  });

  await themeUnit("population", "country", "CZ", undefined, spy);
  await themeUnit("population", "nuts3", "CZ010", undefined, spy);

  assert.deepEqual(seen, [
    { datasetId: "worldbank-sp-pop-totl", geoLevel: "country" },
    { datasetId: "eurostat-demo-r-pjanaggr3", geoLevel: "nuts3" }
  ]);
});

test("the clicked value carries the unit and the source that produced it", async () => {
  const detail = await themeUnit("crime", "nuts3", "CZ031", "2022", queries());
  assert.equal(detail!.period, "2022");
  assert.equal(detail!.unit, "offences per 100 000 people");
  assert.equal(detail!.source.datasetId, "eurostat-crim-gen-reg");
  assert.equal(detail!.rank, 3);
});

test("a territory the series does not contain is not invented", async () => {
  const detail = await themeUnit(
    "crime",
    "nuts3",
    "XX999",
    undefined,
    queries({
      unit: async () => null
    })
  );
  assert.equal(detail, null);
});

test("published regional selection no longer depends on the legacy geometry flag", async () => {
  delete process.env.MAPOS_ALLOW_NONCOMMERCIAL_DATA;
  try {
    const seen: ThemeTileRequest[] = [];
    await themeTile(
      "crime",
      9,
      1,
      1,
      "2023",
      queries({
        tile: async (r) => {
          seen.push(r);
          return new Uint8Array([1]);
        }
      })
    );
    assert.equal(seen[0]?.geoLevel, "nuts3");
  } finally {
    process.env.MAPOS_ALLOW_NONCOMMERCIAL_DATA = "1";
  }
});

test("unpublished finer datasets cannot mask an available country source", async () => {
  const seen: ThemeTileRequest[] = [];
  const q = queries({
    available: async () => ["worldbank-sp-pop-totl"],
    tile: async (r) => {
      seen.push(r);
      return new Uint8Array([1]);
    }
  });
  const metadata = await themeMetadata("population", "latest", q, [], "en", 8);
  await themeTile("population", 10, 510, 350, "latest", q, [], 8);
  assert.equal(metadata!.selectedDatasetId, "worldbank-sp-pop-totl");
  assert.equal(seen[0]!.datasetId, metadata!.selectedDatasetId);
});
test("municipal metadata and tile share resolution; explicit missing years stay empty", async () => {
  const seen: ThemeTileRequest[] = [];
  const q = queries({
    available: async () => ["worldbank-sp-pop-totl", "lau-population-2024"],
    tile: async (r) => {
      seen.push(r);
      return new Uint8Array([1]);
    }
  });
  const metadata = await themeMetadata("population", "latest", q, [], "en", 8);
  await themeTile("population", 7, 65, 45, "latest", q, [], 8);
  assert.equal(metadata!.selectedGeoLevel, "lau");
  assert.equal(seen[0]!.datasetId, metadata!.selectedDatasetId);
  assert.equal(await themeTile("population", 8, 130, 90, "1900", q), null);
  assert.equal(
    await themeTile("population", 8, 130, 90, "latest", queries({ periods: async () => [] })),
    null
  );
});

test("published regional data wins consistently in metadata and tiles at regional zoom", async () => {
  for (const zoom of [3, 6, 9]) {
    let tile: ThemeTileRequest | undefined;
    const q = queries({
      available: async () => ["eurostat-poverty", "eurostat-poverty-country"],
      tile: async (req) => {
        tile = req;
        return new Uint8Array([1]);
      }
    });
    const metadata = await themeMetadata("poverty", undefined, q, [], "cs", zoom);
    await themeTile("poverty", 9, 260, 170, undefined, q, [], zoom);
    assert.equal(metadata?.selectedDatasetId, tile?.datasetId);
    assert.equal(metadata?.selectedGeoLevel, zoom < 4 ? "country" : "nuts2");
  }
});

test("a newer country year does not silently replace the selected regional series", async () => {
  let drawn: ThemeTileRequest | undefined;
  const q = queries({
    available: async () => ["eurostat-poverty", "eurostat-poverty-country"],
    periods: async (ids) => (ids.includes("eurostat-poverty-country") ? ["2025"] : ["2024"]),
    tile: async (r) => {
      drawn = r;
      return new Uint8Array([1]);
    }
  });
  const meta = await themeMetadata("poverty", undefined, q, [], "cs", 9);
  await themeTile("poverty", 9, 1, 1, meta?.period ?? undefined, q, [], 9);
  assert.equal(meta?.period, "2024");
  assert.equal(drawn?.datasetId, meta?.selectedDatasetId);
  assert.equal(drawn?.period, "2024");
});

test("source availability remains published when its display is explicitly excluded", async () => {
  const metadata = await themeMetadata(
    "poverty",
    "2025",
    queries({
      periods: async () => ["2025"],
      quantiles: async () => [10, 20],
      hasGeoUnits: async () => true,
      available: async (ids: readonly string[]) =>
        ids.filter((id) => ["eurostat-poverty", "eurostat-poverty-country"].includes(id))
    }),
    ["eurostat-poverty-country"],
    "cs",
    9
  );
  assert.equal(metadata?.selectedGeoLevel, "nuts2");
  assert.equal(
    metadata?.sources.find((s) => s.datasetId === "eurostat-poverty-country")?.available,
    true
  );
});
