import type { FilterValues } from "@mapos/layer-sdk";
import { registerLayer } from "../registry";
import { createTileLayer } from "../tileLayer";

/**
 * Dated snow cover from NASA GIBS.
 *
 * A snow-cover product is an observation for one day, not a season. The layer therefore carries
 * a date filter and builds its tile URL with that day — two dates are two cacheable images, and
 * the footer legend has to name the day it is describing.
 *
 * The source is keyless and in the public domain. This is deliberately not the same thing as
 * OpenSnowMap's pistes: that draws where people ski, this draws where the ground is white.
 */

/** How far back the picker offers. GIBS holds far more, but a useful default is recent days. */
const DAYS_BACK = 30;

function isoDay(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - offsetDays);
  return date.toISOString().slice(0, 10);
}

/** A valid default: GIBS publishes with a lag, so "yesterday" is the newest reliable day. */
const DEFAULT_DAY = isoDay(1);

function dayFromFilters(filters: FilterValues): string {
  const raw = filters.day;
  // The facet is a multi-select in the v1 schema; the most recent chosen day wins.
  const candidate = Array.isArray(raw) ? raw.find((value) => typeof value === "string") : raw;
  if (typeof candidate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  return DEFAULT_DAY;
}

function snowTiles(day: string): string[] {
  return [
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Snow_Cover/default/${day}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`
  ];
}

registerLayer({
  kind: "raster",
  areaFilter: "context",
  manifest: {
    id: "snow-cover",
    name: "Sněhová pokrývka",
    icon: "❄️",
    color: "#7dd3fc",
    category: "environment",
    description:
      "Denní produkt NASA GIBS (MODIS Terra) · bílá je sníh, šedá mrak nebo chybějící data. Není to předpověď ani výška sněhu."
  },
  filters: [
    {
      id: "day",
      label: "Datum snímku",
      kind: "multi-select",
      options: Array.from({ length: DAYS_BACK }, (_, offset) => {
        const day = isoDay(offset + 1);
        return { id: day, label: day };
      })
    }
  ],
  defaultFilters: { day: DEFAULT_DAY },
  defaultOpacity: 0.7,
  legend: {
    type: "categorical",
    title: "Sněhová pokrývka",
    items: [
      { label: "Sníh", color: "#ffffff", description: "Bílé plochy ve snímku" },
      { label: "Mrak / chybějící data", color: "#9ca3af", description: "Šedé plochy nejsou sníh" }
    ]
  },
  create: (ctx) =>
    createTileLayer(ctx.map, ctx.layerId, {
      tiles: snowTiles(DEFAULT_DAY),
      tilesForFilters: (filters) => snowTiles(dayFromFilters(filters)),
      maxzoom: 8,
      attribution: 'NASA <a href="https://earthdata.nasa.gov/">GIBS / EOSDIS</a> (public domain)'
    }),
  attribution: [
    {
      label: "NASA GIBS / EOSDIS",
      url: "https://earthdata.nasa.gov/",
      license: "public domain"
    }
  ]
});

export { dayFromFilters as snowCoverDay };
