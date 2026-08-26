import type { Bbox } from "./types.js";

/** Which upstream serves basemap tiles, geocoding and routing. Distinct from POI sourcing:
 *  a user can browse CARTO tiles while still pulling Mapy.com places, or vice versa. */
export type DataProvider = "osm" | "mapy";

export const DATA_PROVIDERS: { id: DataProvider; label: string; hint: string }[] = [
  { id: "osm", label: "OpenStreetMap", hint: "CARTO dlaždice, Nominatim, OSRM — bez klíče" },
  { id: "mapy", label: "Mapy.com", hint: "Turistické dlaždice, lepší CZ/SK data, výškový profil" }
];

export type PlaceSourceId =
  "osm" | "mapy" | "fsq" | "wikidata" | "wikipedia" | "park4night" | "overture" | "user";

/** How a source contributes to a viewport query. This is what decides whether the fusion
 *  service can ask it for "everything in this bbox" or has to drive it by keyword. */
export type SourceFetchKind =
  /** Answers a bbox directly and cheaply — the backbone of a viewport query. */
  | "bulk"
  /** Has no bbox endpoint; must be driven by a keyword matrix (see mapyPoiService). */
  | "keyword"
  /** Never queried by bbox — only ever asked about one already-known place. */
  | "enrich";

export interface PlaceSourceDefinition {
  id: PlaceSourceId;
  label: string;
  /** Single character shown in the SourceIconStrip loader. */
  glyph: string;
  kind: SourceFetchKind;
  /** Whether the source is on for a fresh install. */
  defaultEnabled: boolean;
  /** Requires a server-side API key to work at all. */
  needsKey: boolean;
  attribution: string;
  hint: string;
}

export const PLACE_SOURCES: PlaceSourceDefinition[] = [
  {
    id: "osm",
    label: "OpenStreetMap",
    glyph: "O",
    kind: "bulk",
    defaultEnabled: true,
    needsKey: false,
    attribution: "© OpenStreetMap přispěvatelé",
    hint: "Hlavní zdroj. Umí i bezejmenné amenity (parkoviště, WC, voda)."
  },
  {
    id: "mapy",
    label: "Mapy.com",
    glyph: "M",
    kind: "keyword",
    defaultEnabled: true,
    needsKey: true,
    attribution: "© Seznam.cz a.s.",
    hint: "Pojmenovaná místa přes lokalizovaná klíčová slova. Skvělé na hrady, rozhledny, vyhlídky."
  },
  {
    id: "wikidata",
    label: "Wikidata",
    glyph: "W",
    kind: "bulk",
    defaultEnabled: true,
    needsKey: false,
    attribution: "Wikidata (CC0)",
    hint: "Významná místa napříč Evropou, plus QID jako klíč pro spojování zdrojů."
  },
  {
    id: "wikipedia",
    label: "Wikipedia",
    glyph: "P",
    kind: "bulk",
    defaultEnabled: false,
    needsKey: false,
    attribution: "Wikipedia (CC BY-SA)",
    hint: "Články s geolokací — kontext a popisky, ne samostatná POI vrstva."
  },
  {
    id: "overture",
    label: "Overture",
    glyph: "V",
    kind: "bulk",
    defaultEnabled: false,
    needsKey: false,
    attribution: "Overture Maps Foundation (CDLA-Permissive 2.0)",
    hint: "Evropská POI základna importovaná lokálně. Bez rate limitů, ale vyžaduje import."
  },
  {
    id: "park4night",
    label: "Park4Night",
    glyph: "4",
    kind: "bulk",
    defaultEnabled: false,
    needsKey: false,
    attribution: "Park4Night",
    hint: "Vanlife spoty a přespání."
  },
  {
    id: "fsq",
    label: "Foursquare",
    glyph: "F",
    kind: "enrich",
    defaultEnabled: true,
    needsKey: true,
    attribution: "Foursquare",
    hint: "Doplňuje hodnocení, fotky a tipy k už nalezenému místu."
  },
  {
    id: "user",
    label: "Komunita",
    glyph: "U",
    kind: "bulk",
    defaultEnabled: true,
    needsKey: false,
    attribution: "MapOS uživatelé",
    hint: "Veřejné piny z uživatelských vrstev."
  }
];

export const PLACE_SOURCE_BY_ID: Record<PlaceSourceId, PlaceSourceDefinition> = Object.fromEntries(
  PLACE_SOURCES.map((s) => [s.id, s])
) as Record<PlaceSourceId, PlaceSourceDefinition>;

export function defaultPlaceSources(): Record<PlaceSourceId, boolean> {
  return Object.fromEntries(PLACE_SOURCES.map((s) => [s.id, s.defaultEnabled])) as Record<
    PlaceSourceId,
    boolean
  >;
}

/** One source's claim about a place, kept after merging so the UI can show where each
 *  field came from and when it was last refreshed. */
export interface PlaceProvenance {
  source: PlaceSourceId;
  /** The id this source uses natively (OSM `node/123`, Mapy poi id, Wikidata QID…). */
  sourceRef: string;
  /** 0–1. Higher wins when two sources disagree on the same field. */
  confidence: number;
  refreshedAt: string;
}

/** The normalized shape every source is mapped into before dedupe. */
export interface Place {
  /** Stable synthetic id: `${primarySource}:${sourceRef}` of the highest-confidence claim. */
  id: string;
  name: string;
  lng: number;
  lat: number;
  category: string;
  /** Wikidata QID when known — the strongest cross-source join key we have. */
  wikidata?: string;
  address?: string;
  photo?: string;
  rating?: number;
  ratingCount?: number;
  website?: string;
  phone?: string;
  openingHours?: string;
  elevationM?: number;
  tags?: string[];
  sources: PlaceProvenance[];
}

export interface PlacesQuery {
  bbox: Bbox;
  categories: string[];
  sources: PlaceSourceId[];
  lang?: string;
}

export interface PlacesSourceMeta {
  source: PlaceSourceId;
  state: "ready" | "error" | "skipped";
  count: number;
  message?: string;
  /** Wall-clock time the source took, for tuning budgets. */
  tookMs?: number;
}

export interface PlacesResponse {
  places: Place[];
  meta: {
    sources: PlacesSourceMeta[];
    /** Places dropped because another source already had them. */
    merged: number;
  };
}
