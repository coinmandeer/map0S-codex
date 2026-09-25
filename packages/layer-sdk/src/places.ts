import type { Bbox, FeatureCollection } from "./types.js";

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

/** Advisory rights decision for one concrete use of place-source data.
 *
 * `conditional` means the governing licence/terms permit the use only while their obligations
 * are met; it is deliberately distinct from an unconditional permission. In prototype mode this
 * record is displayed and audited but never changes runtime availability. */
export type PlaceSourcePermissionDecision =
  "permitted" | "conditional" | "owner-controlled" | "not-approved";

export interface PlaceSourcePermissions {
  display: PlaceSourcePermissionDecision;
  cache: PlaceSourcePermissionDecision;
  export: PlaceSourcePermissionDecision;
  redistribute: PlaceSourcePermissionDecision;
  aiUse: PlaceSourcePermissionDecision;
}

export type PlaceSourceReleaseState =
  "released" | "capability-gated" | "owner-controlled" | "blocked";

export type PlaceSourceRightsBasis =
  "open-license" | "service-terms" | "owner-controlled" | "provider-restriction";

/** Machine-readable advisory rights record.
 *
 * `governingTermsId` is also shown in attribution UI via `license`, so a human-visible vague
 * label cannot disagree with the decision CI validates. Provider entries use an HTTPS evidence
 * page. The sole exception is owner-controlled data, whose permission is attached per record and
 * governed by the local publication policy rather than a third-party licence page. */
export interface PlaceSourceReleaseRights {
  state: PlaceSourceReleaseState;
  basis: PlaceSourceRightsBasis;
  governingTermsId: string;
  evidenceUrl: string | null;
  permissions: PlaceSourcePermissions;
  attributionRequired: boolean;
  /** Independent server capability needed for technical runtime access. */
  capability?: "mapy" | "fsq" | "park4night";
  ownerControl?: {
    policyId: "MAPOS-OWNER-CONTROLLED-PLACE-DATA-v1";
    scope: "per-record";
    publicReleaseRequiresOwnerGrant: true;
  };
}

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
  /** Where the credit links to, and under what terms the data may be shown. Both feed the
   *  attribution registry; a source without them is credited by name only. */
  url?: string;
  license?: string;
  /** Advisory source-rights record; never a prototype runtime or release switch. */
  releaseRights: PlaceSourceReleaseRights;
  hint: string;
  /** Shown next to the data, not in settings: a warning the reader needs in order to judge what
   *  they are looking at (unverified scrape, crowdsourced, delayed). */
  caveat?: string;
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
    url: "https://www.openstreetmap.org/copyright",
    license: "ODbL-1.0",
    releaseRights: {
      state: "released",
      basis: "open-license",
      governingTermsId: "ODbL-1.0",
      evidenceUrl: "https://www.openstreetmap.org/copyright",
      permissions: {
        display: "conditional",
        cache: "conditional",
        export: "conditional",
        redistribute: "conditional",
        aiUse: "conditional"
      },
      attributionRequired: true
    },
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
    url: "https://developer.mapy.com/terms/",
    license: "MAPY.COM-DEVELOPER-TERMS",
    releaseRights: {
      state: "capability-gated",
      basis: "service-terms",
      governingTermsId: "MAPY.COM-DEVELOPER-TERMS",
      evidenceUrl: "https://developer.mapy.com/terms/",
      permissions: {
        display: "conditional",
        cache: "conditional",
        export: "not-approved",
        redistribute: "not-approved",
        aiUse: "not-approved"
      },
      attributionRequired: true,
      capability: "mapy"
    },
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
    url: "https://www.wikidata.org/wiki/Wikidata:Copyright",
    license: "CC0-1.0",
    releaseRights: {
      state: "released",
      basis: "open-license",
      governingTermsId: "CC0-1.0",
      evidenceUrl: "https://www.wikidata.org/wiki/Wikidata:Copyright",
      permissions: {
        display: "permitted",
        cache: "permitted",
        export: "permitted",
        redistribute: "permitted",
        aiUse: "permitted"
      },
      attributionRequired: false
    },
    hint: "Významná místa napříč Evropou, plus QID jako klíč pro spojování zdrojů."
  },
  {
    id: "wikipedia",
    label: "Wikipedia",
    glyph: "P",
    kind: "bulk",
    defaultEnabled: true,
    needsKey: false,
    attribution: "Wikipedia (CC BY-SA)",
    url: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
    license: "CC-BY-SA-4.0",
    releaseRights: {
      state: "released",
      basis: "open-license",
      governingTermsId: "CC-BY-SA-4.0",
      evidenceUrl: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
      permissions: {
        display: "conditional",
        cache: "conditional",
        export: "conditional",
        redistribute: "conditional",
        aiUse: "conditional"
      },
      attributionRequired: true
    },
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
    url: "https://docs.overturemaps.org/attribution/",
    license: "CDLA-Permissive-2.0",
    releaseRights: {
      state: "released",
      basis: "open-license",
      governingTermsId: "CDLA-Permissive-2.0",
      evidenceUrl: "https://docs.overturemaps.org/attribution/",
      permissions: {
        display: "conditional",
        cache: "conditional",
        export: "conditional",
        redistribute: "conditional",
        aiUse: "conditional"
      },
      attributionRequired: true
    },
    hint: "Evropská POI základna importovaná lokálně. Bez rate limitů, ale vyžaduje import."
  },
  {
    id: "park4night",
    label: "Park4Night",
    glyph: "4",
    kind: "bulk",
    defaultEnabled: true,
    needsKey: false,
    attribution: "Park4Night",
    url: "https://plus.park4night.com/en/cgu",
    license: "PARK4NIGHT-GTCU-ARTICLE-5-PRIOR-AUTHORIZATION-REQUIRED",
    releaseRights: {
      state: "blocked",
      basis: "provider-restriction",
      governingTermsId: "PARK4NIGHT-GTCU-ARTICLE-5-PRIOR-AUTHORIZATION-REQUIRED",
      evidenceUrl: "https://plus.park4night.com/en/cgu",
      permissions: {
        display: "not-approved",
        cache: "not-approved",
        export: "not-approved",
        redistribute: "not-approved",
        aiUse: "not-approved"
      },
      attributionRequired: true,
      capability: "park4night"
    },
    hint: "Prototypově dostupné po zapnutí serverového přepínače; zdroj může být nestabilní.",
    caveat: "Neoficiální upstream bez garantovaného API; údaje ověřte před cestou."
  },
  {
    id: "fsq",
    label: "Foursquare",
    glyph: "F",
    kind: "enrich",
    defaultEnabled: true,
    needsKey: true,
    attribution: "Foursquare",
    url: "https://foursquare.com/legal/terms",
    license: "FOURSQUARE-DEVELOPER-TERMS",
    releaseRights: {
      state: "capability-gated",
      basis: "service-terms",
      governingTermsId: "FOURSQUARE-DEVELOPER-TERMS",
      evidenceUrl: "https://foursquare.com/legal/terms",
      permissions: {
        display: "conditional",
        cache: "conditional",
        export: "not-approved",
        redistribute: "not-approved",
        aiUse: "not-approved"
      },
      attributionRequired: true,
      capability: "fsq"
    },
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
    license: "MAPOS-OWNER-CONTROLLED-PLACE-DATA-v1",
    releaseRights: {
      state: "owner-controlled",
      basis: "owner-controlled",
      governingTermsId: "MAPOS-OWNER-CONTROLLED-PLACE-DATA-v1",
      evidenceUrl: null,
      permissions: {
        display: "owner-controlled",
        cache: "owner-controlled",
        export: "owner-controlled",
        redistribute: "owner-controlled",
        aiUse: "owner-controlled"
      },
      attributionRequired: false,
      ownerControl: {
        policyId: "MAPOS-OWNER-CONTROLLED-PLACE-DATA-v1",
        scope: "per-record",
        publicReleaseRequiresOwnerGrant: true
      }
    },
    hint: "Veřejné piny z uživatelských vrstev.",
    caveat: "Přidali uživatelé MapOS, bez redakční kontroly."
  }
];

export const PLACE_SOURCE_BY_ID: Record<PlaceSourceId, PlaceSourceDefinition> = Object.fromEntries(
  PLACE_SOURCES.map((s) => [s.id, s])
) as Record<PlaceSourceId, PlaceSourceDefinition>;

/**
 * Prototype policy: rights records are advisory metadata and never remove data from the picker.
 * Technical availability (credentials, provider health and server capability) remains separate.
 */
export function placeSourceRuntimeAllowed(_source: PlaceSourceDefinition): boolean {
  return true;
}

/** Backward-compatible name used by the UI; in prototype mode it contains the complete catalog. */
export const RELEASED_PLACE_SOURCES = [...PLACE_SOURCES];

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
  /** Foursquare venue id, once enrichment has matched one. Kept on the place rather than only
   *  inside the enrichment payload so info panels can address Foursquare directly. */
  fsqId?: string;
  address?: string;
  description?: string;
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

/** Provenance flattened into a single GeoJSON-safe string, e.g. `osm:node/240|wikidata:Q42`.
 *
 *  MapLibre only carries JSON scalars through feature properties, but an info panel asking
 *  Wikidata or Foursquare about a place needs that source's own id — not just the fact that the
 *  source contributed. Encoding the pairs keeps those ids reachable from a clicked pin. */
export function encodeSourceRefs(sources: PlaceProvenance[]): string {
  return sources
    .filter((s) => s.sourceRef)
    .map((s) => `${s.source}:${s.sourceRef}`)
    .join("|");
}

export function parseSourceRefs(raw: unknown): Array<{ source: PlaceSourceId; ref: string }> {
  if (typeof raw !== "string" || !raw) return [];
  const out: Array<{ source: PlaceSourceId; ref: string }> = [];
  for (const entry of raw.split("|")) {
    const at = entry.indexOf(":");
    if (at <= 0) continue;
    const source = entry.slice(0, at);
    const ref = entry.slice(at + 1);
    if (ref && source in PLACE_SOURCE_BY_ID) out.push({ source: source as PlaceSourceId, ref });
  }
  return out;
}

export function sourceRef(raw: unknown, source: PlaceSourceId): string | null {
  return parseSourceRefs(raw).find((r) => r.source === source)?.ref ?? null;
}

export interface PlacesQuery {
  bbox: Bbox;
  categories: string[];
  sources: PlaceSourceId[];
  lang?: string;
}

export interface PlacesSourceMeta {
  source: PlaceSourceId;
  state: "ready" | "loading" | "error" | "skipped";
  count: number;
  message?: string;
  /** Wall-clock time the source took, for tuning budgets. */
  tookMs?: number;
}

export interface PlacesResponse {
  query?: FeatureCollection["query"];
  places: Place[];
  meta: {
    sources: PlacesSourceMeta[];
    /** Places dropped because another source already had them. */
    merged: number;
  };
}
