/**
 * The themes a user switches on, as `mapos.theme` manifests.
 *
 * A theme is not a dataset. "Crime" is a question, and the answer comes from whichever source
 * covers the territory on screen at the finest resolution available — Eurostat NUTS 3 across
 * Europe, a national register inside one country, nothing at all in the middle of the Atlantic.
 * Keeping that indirection is what lets a single switch stay a single switch (§23.3) while the
 * data underneath changes with the viewport.
 *
 * These are manifests rather than an ad-hoc shape so the schema in `layer-sdk` is the contract:
 * a community theme arriving as a JSON file is validated against the same rules as these four
 * and needs no code.
 *
 * The first four are the European set from §23.4. National detail sources are added to
 * `sources` as they land, which is a manifest edit and not a new switch.
 */

import { STAT_DATASETS } from "@mapos/adapter-sdk";
import type { ThemeManifestV2 } from "@mapos/layer-sdk";

const LEGACY_THEMES: readonly ThemeManifestV2[] = [
  {
    schema: "mapos.theme",
    schemaVersion: "2.0.0",
    id: "crime",
    name: "Intentional homicide",
    icon: "local_police",
    unit: "offences per 100 000 people",
    // Eurostat already publishes this per hundred thousand, so nothing is recomputed —
    // normalising a normalised series is how a crime rate becomes nonsense.
    normalization: "per_100k",
    directionGoodBad: "higher-is-worse",
    // The comparison really is unsafe, and saying so is not a disclaimer: the definition of an
    // offence differs between states, so a border can look like a cliff for legal reasons.
    disclosure:
      "Compare with care: what counts as an offence, and how willingly it is reported, differs between states.",
    sources: [{ datasetId: "eurostat-crim-gen-reg", role: "primary" }],
    legend: { classes: 5, method: "quantile" },
    i18n: {
      cs: {
        name: "Úmyslná zabití",
        unit: "trestných činů na 100 000 obyvatel",
        disclosure:
          "Srovnávejte opatrně: definice trestných činů a ochota je nahlásit se mezi státy liší."
      }
    }
  },
  {
    schema: "mapos.theme",
    schemaVersion: "2.0.0",
    id: "accidents",
    name: "Road deaths",
    icon: "car_crash",
    unit: "people killed",
    normalization: "raw",
    directionGoodBad: "higher-is-worse",
    disclosure: "Eurostat publishes this by NUTS 2 region, not by municipality.",
    sources: [{ datasetId: "eurostat-tran-r-acci", role: "primary" }],
    legend: { classes: 5, method: "quantile" },
    i18n: {
      cs: {
        name: "Nehody",
        unit: "zabitých osob",
        disclosure: "Eurostat publikuje tento údaj po regionech NUTS 2, ne po obcích."
      }
    }
  },
  {
    schema: "mapos.theme",
    schemaVersion: "2.0.0",
    id: "population",
    name: "Population",
    icon: "groups",
    unit: "people",
    normalization: "raw",
    i18n: { cs: { name: "Populace", unit: "obyvatel" } },
    directionGoodBad: "neutral",
    sources: [
      { datasetId: "eurostat-demo-r-pjanaggr3", role: "primary" },
      // Outside Europe the country level is what there is, and it is what keeps the theme from
      // stopping at the union border.
      { datasetId: "worldbank-sp-pop-totl", role: "detail" }
    ],
    legend: { classes: 5, method: "quantile" }
  },
  {
    schema: "mapos.theme",
    schemaVersion: "2.0.0",
    id: "air",
    name: "Air quality",
    icon: "air",
    unit: "µg/m³ PM2.5",
    normalization: "raw",
    directionGoodBad: "higher-is-worse",
    disclosure:
      "This is the population-weighted annual mean for a whole country. Air quality between two streets can differ more than between two countries.",
    // Eurostat's SDG series is coarse — one number per country — but it is a number, and a
    // theme with no source at all is a switch that can only disappoint. The EEA station network
    // is a point source and joins later with the `point` role, drawn on top rather than
    // coloured in.
    sources: [],
    legend: { classes: 5, method: "quantile" },
    i18n: {
      cs: {
        name: "Ovzduší",
        disclosure:
          "Jde o roční průměr celé země, vážený počtem obyvatel. Mezi dvěma ulicemi se ovzduší může lišit víc než mezi dvěma státy."
      }
    }
  }
];

export const THEMES: readonly ThemeManifestV2[] = [
  ...LEGACY_THEMES.map((t) => ({
    ...t,
    sources: [
      ...t.sources,
      ...STAT_DATASETS.filter((d) => d.themeId === t.id).map((d) => ({
        datasetId: d.id,
        role: "detail" as const
      }))
    ]
  })),
  ...[
    ...new Set(
      STAT_DATASETS.map((d) => d.themeId).filter(
        (id): id is string => Boolean(id) && !LEGACY_THEMES.some((t) => t.id === id)
      )
    )
  ].map((id) => {
    const datasets = STAT_DATASETS.filter((d) => d.themeId === id);
    const first = datasets[0]!;
    return {
      schema: "mapos.theme" as const,
      schemaVersion: "2.0.0" as const,
      id,
      icon: "bar_chart",
      name: first.name,
      unit: first.unit,
      normalization: first.normalization,
      directionGoodBad: first.higherIsWorse ? ("higher-is-worse" as const) : ("neutral" as const),
      sources: datasets.map((d, i) => ({
        datasetId: d.id,
        role: i === 0 ? ("primary" as const) : ("detail" as const)
      })),
      legend: { classes: 5, method: "quantile" as const },
      i18n: { cs: { name: first.nameCs ?? first.name } },
      ...(first.group === "safety"
        ? {
            disclosure:
              "Police-recorded offences; definitions and reporting practices differ between countries."
          }
        : {})
    };
  })
];
export function themeGroup(id: string): string {
  return (
    STAT_DATASETS.find((d) => d.themeId === id)?.group ??
    { crime: "safety", accidents: "safety", population: "population", air: "environment" }[id] ??
    "other"
  );
}

export function theme(id: string): ThemeManifestV2 | undefined {
  return THEMES.find((entry) => entry.id === id);
}

/**
 * Which `geo_units.level` a zoom should be drawn at.
 *
 * The steps are where the levels stop being readable rather than round numbers: below z4 a NUTS
 * 3 fill is smaller than a pixel and the whole continent is one smear, and above z6 country
 * polygons are so much larger than the viewport that the map looks like a solid colour.
 */
export function geoLevelForZoom(zoom: number): "country" | "nuts1" | "nuts2" | "nuts3" {
  if (zoom < 4) return "country";
  if (zoom < 5) return "nuts1";
  if (zoom < 6) return "nuts2";
  return "nuts3";
}
