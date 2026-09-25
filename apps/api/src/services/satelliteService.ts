import { fetchJson } from "../utils/upstream.js";

/**
 * Orbital elements for satellites, from CelesTrak's GP catalogue.
 *
 * CelesTrak publishes modern GP data as OMM JSON — not the five-digit TLE numbers the plan warns
 * against — so the ids here are the real NORAD catalogue numbers and the fields are the ones
 * SGP4 actually needs. The browser propagates them locally (see the web `satelliteLayer`), which
 * is why this endpoint returns elements rather than positions: a satellite position is only valid
 * for the instant it was computed for, and re-requesting it every second would be absurd.
 *
 * The catalogue is cached for a few hours. Orbital elements age slowly, and CelesTrak is a free,
 * donation-funded service that should see one polite caller, not one per map.
 */

export interface SatelliteCategory {
  id: string;
  label: string;
  /** CelesTrak group name. */
  group: string;
  /** A short line for the layer settings. */
  hint: string;
  defaultOn?: boolean;
}

/** Curated from CelesTrak's catalogue: the groups a reader recognises, plus the large
 *  constellations that are genuinely interesting to watch. Debris clouds are not offered, and the
 *  biggest shells are sampled with a stated cap rather than drawn in full. */
export const SATELLITE_CATEGORIES: SatelliteCategory[] = [
  {
    id: "stations",
    label: "Stanice",
    group: "stations",
    hint: "Mezinárodní vesmírná stanice a další obydlené stanice",
    defaultOn: true
  },
  {
    id: "starlink",
    label: "Starlink",
    group: "starlink",
    hint: "Největší konstelace; zobrazen je výběr z tisíců objektů"
  },
  {
    id: "oneweb",
    label: "OneWeb",
    group: "oneweb",
    hint: "Konstelace pro připojení, nízká oběžná dráha"
  },
  { id: "gps", label: "Navigace (GPS)", group: "gps-ops", hint: "Operační družice GPS" },
  { id: "glonass", label: "Navigace (GLONASS)", group: "glo-ops", hint: "Ruský navigační systém" },
  {
    id: "galileo",
    label: "Navigace (Galileo)",
    group: "galileo",
    hint: "Evropský navigační systém"
  },
  { id: "beidou", label: "Navigace (BeiDou)", group: "beidou", hint: "Čínský navigační systém" },
  {
    id: "gnss",
    label: "Navigace (GNSS)",
    group: "gnss",
    hint: "GPS, GLONASS, Galileo, BeiDou a SBAS dohromady"
  },
  {
    id: "geo",
    label: "Geostacionární",
    group: "geo",
    hint: "Družice nad rovníkem, které zůstávají nad stejným místem"
  },
  {
    id: "weather",
    label: "Počasí",
    group: "weather",
    hint: "Meteorologické družice NOAA, Metop a další"
  },
  {
    id: "resource",
    label: "Snímkování Země",
    group: "resource",
    hint: "Družice pro dálkový průzkum Země"
  },
  {
    id: "planet",
    label: "Planet",
    group: "planet",
    hint: "Konstelace malých družic pro denní snímky Země"
  },
  {
    id: "iridium",
    label: "Iridium",
    group: "iridium-NEXT",
    hint: "Konstelace pro satelitní telefony a data"
  },
  {
    id: "globalstar",
    label: "Globalstar",
    group: "globalstar",
    hint: "Konstelace pro hlas a data"
  },
  {
    id: "communication",
    label: "Komunikační",
    group: "other-comm",
    hint: "Ostatní komunikační družice"
  },
  { id: "science", label: "Věda", group: "science", hint: "Vědecké a výzkumné družice" },
  {
    id: "military",
    label: "Vojenské",
    group: "military",
    hint: "Vojenské družice z veřejného katalogu"
  },
  {
    id: "sarsat",
    label: "Záchranná služba",
    group: "sarsat",
    hint: "Družice pro příjem nouzových signálů (COSPAS-SARSAT)"
  },
  {
    id: "tdrss",
    label: "Relé a spojení",
    group: "tdrss",
    hint: "Družice zajišťující přenos dat mezi Zemí a stanicemi"
  },
  { id: "amateur", label: "Amatérské", group: "amateur", hint: "Radioamatérské družice" },
  {
    id: "visual",
    label: "Viditelné okem",
    group: "visual",
    hint: "Jasné družice, které lze spatřit ze Země"
  },
  {
    id: "cubesat",
    label: "CubeSaty",
    group: "cubesat",
    hint: "Malé výzkumné a studentské družice"
  },
  {
    id: "engineering",
    label: "Technologické",
    group: "engineering",
    hint: "Technologické a testovací družice"
  },
  { id: "education", label: "Výukové", group: "education", hint: "Studentské a výukové družice" },
  { id: "radar", label: "Radarové", group: "radar", hint: "Radarové a průzkumné družice" }
];

/** How many objects one category contributes. CelesTrak returns thousands for the large
 *  constellations; the map draws a stated sample, and the layer says so in its hint. */
const MAX_PER_CATEGORY = 120;
/** Ceiling across all chosen categories. Every satellite is one SGP4 record and one dot, and its
 *  track is a polyline, so the total decides the frame cost. */
const MAX_TOTAL = 600;
const CACHE_TTL_MS = 3 * 3600_000;

export interface SatelliteElements {
  /** NORAD catalogue number, as a string because that is its stable identity. */
  id: string;
  name: string;
  category: string;
  objectId: string | null;
  /** ISO instant the elements are valid for. Shown to the reader as the element epoch. */
  epoch: string;
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  raOfAscNode: number;
  argOfPericenter: number;
  meanAnomaly: number;
  bstar: number;
  meanMotionDot: number;
  meanMotionDdot: number;
  /** CelesTrak's own number, kept so a future TLE fallback keeps identity. */
  noradCatId: number;
}

export interface SatelliteCatalog {
  categories: Array<{ id: string; label: string; hint: string; defaultOn: boolean; count: number }>;
  elements: SatelliteElements[];
  /** The newest element epoch across what was returned, so the UI can state its age. */
  epoch: string | null;
  source: {
    id: "celestrak";
    label: "CelesTrak GP";
    url: string;
    license: string;
    computed: true;
  };
  /** Categories asked for that CelesTrak could not serve, so an outage is not an empty map. */
  unavailable: string[];
}

const SOURCE: SatelliteCatalog["source"] = {
  id: "celestrak",
  label: "CelesTrak GP",
  url: "https://celestrak.org/NORAD/documentation/gp-data-formats.php",
  license: "CelesTrak GP data is public; see CelesTrak usage policy",
  computed: true
};

interface RawGp {
  OBJECT_NAME?: string;
  OBJECT_ID?: string;
  EPOCH?: string;
  MEAN_MOTION?: number;
  ECCENTRICITY?: number;
  INCLINATION?: number;
  RA_OF_ASC_NODE?: number;
  ARG_OF_PERICENTER?: number;
  MEAN_ANOMALY?: number;
  BSTAR?: number;
  MEAN_MOTION_DOT?: number;
  MEAN_MOTION_DDOT?: number;
  NORAD_CAT_ID?: number;
}

function categoryById(id: string): SatelliteCategory | undefined {
  return SATELLITE_CATEGORIES.find((category) => category.id === id);
}

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** One raw CelesTrak row to the OMM subset SGP4 needs. A row missing the numbers SGP4 cannot
 *  work without is dropped rather than propagated into a nonsense position. */
export function parseElements(raw: unknown, categoryId: string): SatelliteElements | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as RawGp;
  const noradCatId = finite(record.NORAD_CAT_ID);
  const meanMotion = finite(record.MEAN_MOTION);
  const eccentricity = finite(record.ECCENTRICITY);
  const inclination = finite(record.INCLINATION);
  const raOfAscNode = finite(record.RA_OF_ASC_NODE);
  const argOfPericenter = finite(record.ARG_OF_PERICENTER);
  const meanAnomaly = finite(record.MEAN_ANOMALY);
  if (
    noradCatId === null ||
    meanMotion === null ||
    eccentricity === null ||
    inclination === null ||
    raOfAscNode === null ||
    argOfPericenter === null ||
    meanAnomaly === null ||
    typeof record.EPOCH !== "string"
  ) {
    return null;
  }
  const epochMs = Date.parse(record.EPOCH);
  if (!Number.isFinite(epochMs)) return null;
  const name =
    typeof record.OBJECT_NAME === "string" && record.OBJECT_NAME.trim()
      ? record.OBJECT_NAME.trim().slice(0, 120)
      : `NORAD ${noradCatId}`;
  return {
    id: String(noradCatId),
    name,
    category: categoryId,
    objectId: typeof record.OBJECT_ID === "string" ? record.OBJECT_ID : null,
    epoch: new Date(epochMs).toISOString(),
    meanMotion,
    eccentricity,
    inclination,
    raOfAscNode,
    argOfPericenter,
    meanAnomaly,
    bstar: finite(record.BSTAR) ?? 0,
    meanMotionDot: finite(record.MEAN_MOTION_DOT) ?? 0,
    meanMotionDdot: finite(record.MEAN_MOTION_DDOT) ?? 0,
    noradCatId
  };
}

const cache = new Map<string, { at: number; elements: SatelliteElements[] }>();

/** One category's elements, cached. A failed fetch is reported as unavailable rather than cached
 *  as empty, so a temporary CelesTrak hiccup does not look like a group with no satellites. */
export async function fetchCategory(
  category: SatelliteCategory,
  signal?: AbortSignal
): Promise<{ elements: SatelliteElements[]; available: boolean }> {
  const cached = cache.get(category.id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { elements: cached.elements, available: true };
  }
  try {
    const rows = await fetchJson<unknown[]>(
      `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(category.group)}&FORMAT=json`,
      {
        providerId: "celestrak",
        ttlMs: CACHE_TTL_MS,
        timeoutMs: 30_000,
        // The large constellations are multi-megabyte JSON; the default 4 MiB cap would refuse
        // Starlink outright. CelesTrak allows this once per group per two hours, so the fetch is
        // rare, and the parsed result is capped to MAX_PER_CATEGORY below.
        maxResponseBytes: 16 * 1024 * 1024,
        signal
      }
    );
    const elements = (Array.isArray(rows) ? rows : [])
      .flatMap((row) => {
        const parsed = parseElements(row, category.id);
        return parsed ? [parsed] : [];
      })
      .slice(0, MAX_PER_CATEGORY);
    cache.set(category.id, { at: Date.now(), elements });
    return { elements, available: true };
  } catch {
    // A stale cache still beats an empty map when the upstream is briefly unreachable.
    if (cached) return { elements: cached.elements, available: true };
    return { elements: [], available: false };
  }
}

/** Elements for the requested categories, or the default set when none are named. */
export async function satelliteCatalog(
  categoryIds: string[],
  signal?: AbortSignal
): Promise<SatelliteCatalog> {
  const requested = categoryIds.length
    ? categoryIds
        .map(categoryById)
        .filter((category): category is SatelliteCategory => Boolean(category))
    : SATELLITE_CATEGORIES.filter((category) => category.defaultOn);

  const results = await Promise.all(
    requested.map(async (category) => ({ category, ...(await fetchCategory(category, signal)) }))
  );

  const elements: SatelliteElements[] = [];
  const unavailable: string[] = [];
  const counts = new Map<string, number>();
  // Take a fair share from each category rather than letting the first one fill the budget, so
  // choosing several categories still shows all of them.
  const share = Math.max(1, Math.floor(MAX_TOTAL / Math.max(1, results.length)));
  for (const result of results) {
    counts.set(result.category.id, result.elements.length);
    if (!result.available) unavailable.push(result.category.id);
    elements.push(...result.elements.slice(0, share));
  }

  const epochMs = elements
    .map((element) => Date.parse(element.epoch))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];

  return {
    categories: SATELLITE_CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
      hint: category.hint,
      defaultOn: Boolean(category.defaultOn),
      count: counts.get(category.id) ?? 0
    })),
    elements,
    epoch: epochMs ? new Date(epochMs).toISOString() : null,
    source: SOURCE,
    unavailable
  };
}

export function satelliteCategoryIds(): string[] {
  return SATELLITE_CATEGORIES.map((category) => category.id);
}

const byIdCache = new Map<string, { at: number; elements: SatelliteElements[] }>();

/** One satellite by NORAD catalogue number, resolved from the loaded category caches or from a
 *  single CATNR query to CelesTrak. This is an identity lookup for the place detail and the AI
 *  overview — not a position: the browser still propagates the element with SGP4. */
export async function satelliteById(
  noradId: string,
  signal?: AbortSignal
): Promise<SatelliteElements | null> {
  for (const entry of cache.values()) {
    const hit = entry.elements.find((element) => element.id === noradId);
    if (hit) return hit;
  }
  const cached = byIdCache.get(noradId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.elements[0] ?? null;
  }
  try {
    const rows = await fetchJson<unknown[]>(
      `https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(noradId)}&FORMAT=json`,
      {
        providerId: "celestrak",
        ttlMs: CACHE_TTL_MS,
        timeoutMs: 15_000,
        maxResponseBytes: 256 * 1024,
        signal
      }
    );
    const elements = (Array.isArray(rows) ? rows : [])
      .flatMap((row) => {
        const parsed = parseElements(row, "query");
        return parsed ? [parsed] : [];
      })
      .slice(0, 1);
    byIdCache.set(noradId, { at: Date.now(), elements });
    return elements[0] ?? null;
  } catch {
    if (cached) return cached.elements[0] ?? null;
    return null;
  }
}

/** Test seam: the catalogue cache is module-level. */
export function resetSatelliteCache(): void {
  cache.clear();
}
