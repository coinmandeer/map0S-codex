import type { FilterValues } from "@mapos/layer-sdk";
import { registerLayer } from "../registry";
import { createTileLayer } from "../tileLayer";

/**
 * Land cover from NASA GIBS (MODIS IGBP, annual).
 *
 * ESA WorldCover is a separate 10 m layer; this source retains the annual MODIS series.
 *
 * One edition per year: the class boundaries are the IGBP scheme's own, and the legend uses the
 * exact colours and names GIBS publishes, so the key matches the pixels.
 */

const IGBP_START = 2001;
const IGBP_LATEST = 2024;

/** IGBP class → label and the GIBS colormap RGB. Kept in the product's own order. */
// Reference: https://gibs.earthdata.nasa.gov/colormaps/v1.0/output/MODIS_IGBP_Land_Cover_Type.html
const IGBP_CLASSES: Array<{ value: number; label: string; rgb: string }> = [
  { value: 1, label: "Stálezelený jehličnatý les", rgb: "33,138,33" },
  { value: 2, label: "Stálezelený listnatý les", rgb: "49,204,49" },
  { value: 3, label: "Opadavý jehličnatý les", rgb: "152,204,49" },
  { value: 4, label: "Opadavý listnatý les", rgb: "150,250,150" },
  { value: 5, label: "Smíšený les", rgb: "141,186,141" },
  { value: 6, label: "Zapojené křoviny", rgb: "186,141,141" },
  { value: 7, label: "Rozvolněné křoviny", rgb: "245,222,179" },
  { value: 8, label: "Stromová savana", rgb: "218,235,157" },
  { value: 9, label: "Savana", rgb: "255,213,0" },
  { value: 10, label: "Travní porosty", rgb: "240,185,103" },
  { value: 11, label: "Trvalé mokřady", rgb: "71,131,181" },
  { value: 12, label: "Zemědělská půda", rgb: "250,239,115" },
  { value: 13, label: "Zastavěné území a města", rgb: "255,0,0" },
  { value: 14, label: "Mozaika polí a přirozené vegetace", rgb: "153,147,86" },
  { value: 15, label: "Trvalý sníh a led", rgb: "255,255,255" },
  { value: 16, label: "Holá půda a řídká vegetace", rgb: "191,191,189" },
  { value: 17, label: "Vodní plochy", rgb: "134,202,227" }
];

const DEFAULT_YEAR = IGBP_LATEST;

function tileUrl(year: number): string[] {
  const day = `${Math.min(Math.max(year, IGBP_START), IGBP_LATEST)}-01-01`;
  return [
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual/default/${day}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`
  ];
}

function yearFromFilters(filters: FilterValues): number {
  const raw = filters.year;
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(candidate);
  return Number.isInteger(parsed) && parsed >= IGBP_START && parsed <= IGBP_LATEST
    ? parsed
    : DEFAULT_YEAR;
}

registerLayer({
  kind: "raster",
  areaFilter: "context",
  manifest: {
    id: "land-cover",
    name: "Pokryv krajiny",
    icon: "🌍",
    color: "#15803d",
    category: "environment",
    description:
      "Roční klasifikace pokryvu krajiny NASA GIBS (MODIS IGBP). Jde o modelová data s ročním krokem, nikoliv o aktuální stav ani o WorldCover pro Evropu."
  },
  filters: [
    {
      id: "year",
      label: "Rok vrstvy",
      kind: "multi-select",
      options: Array.from({ length: IGBP_LATEST - IGBP_START + 1 }, (_, index) => {
        const year = IGBP_LATEST - index;
        return { id: String(year), label: String(year) };
      }),
      default: String(DEFAULT_YEAR)
    }
  ],
  defaultFilters: { year: String(DEFAULT_YEAR) },
  defaultOpacity: 0.75,
  legend: {
    type: "categorical",
    title: "Pokryv krajiny — IGBP",
    items: IGBP_CLASSES.map((entry) => ({
      label: entry.label,
      color: `rgb(${entry.rgb})`
    }))
  },
  create: (ctx) =>
    createTileLayer(ctx.map, ctx.layerId, {
      tiles: tileUrl(DEFAULT_YEAR),
      tilesForFilters: (filters) => tileUrl(yearFromFilters(filters)),
      maxzoom: 8,
      attribution:
        'NASA <a href="https://earthdata.nasa.gov/">GIBS / EOSDIS</a> · MODIS IGBP (public domain)'
    }),
  attribution: [
    {
      label: "NASA GIBS / EOSDIS · MODIS IGBP Land Cover",
      url: "https://earthdata.nasa.gov/",
      license: "public domain"
    }
  ]
});

export { IGBP_CLASSES as LAND_COVER_CLASSES, yearFromFilters as landCoverYear };
