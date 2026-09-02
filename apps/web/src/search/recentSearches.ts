import { parseCoordinates, type Coordinates } from "./coordinates.js";
import { parseMapShareUrl } from "./shareUrl.js";
import { containsControlCharacters } from "./textSafety.js";

export const RECENT_SEARCHES_KEY = "mapos:recent-searches:v1";
export const LEGACY_SEARCH_HISTORY_KEY = "mapos:search-history";
export const RECENT_SEARCHES_VERSION = 1 as const;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type RecentSearchKind =
  "address" | "locality" | "poi" | "place" | "category" | "coordinates" | "map-share" | "ai";

export interface RecentSearchEntry {
  id: string;
  query: string;
  label: string;
  kind: RecentSearchKind;
  usedAt: number;
  coordinates?: Coordinates;
}

interface RecentSearchEnvelope {
  version: typeof RECENT_SEARCHES_VERSION;
  entries: RecentSearchEntry[];
}

export interface AddRecentSearch {
  query: string;
  label?: string;
  kind: RecentSearchKind;
  coordinates?: Coordinates;
}

export interface RecentSearchRepositoryOptions {
  maxEntries?: number;
  now?: () => number;
  /** Exact coordinate and map-share searches are excluded unless the user opted in. */
  persistPreciseLocations?: boolean;
}

export interface RecentSearchRepository {
  list(): RecentSearchEntry[];
  add(entry: AddRecentSearch): RecentSearchEntry[];
  clear(): boolean;
}

const PRECISE_KINDS = new Set<RecentSearchKind>(["coordinates", "map-share"]);

function safeText(value: unknown, maximum = 240): string | null {
  if (typeof value !== "string" || containsControlCharacters(value)) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized && normalized.length <= maximum ? normalized : null;
}

function hash(value: string): string {
  let current = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    current ^= value.charCodeAt(index);
    current = Math.imul(current, 0x01000193);
  }
  return (current >>> 0).toString(36);
}

function entryId(kind: RecentSearchKind, query: string): string {
  return `recent-${hash(`${kind}:${query.toLocaleLowerCase("cs-CZ")}`)}`;
}

function isKind(value: unknown): value is RecentSearchKind {
  return (
    typeof value === "string" &&
    ["address", "locality", "poi", "place", "category", "coordinates", "map-share", "ai"].includes(
      value
    )
  );
}

function isCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Coordinates>;
  return (
    typeof candidate.lat === "number" &&
    typeof candidate.lng === "number" &&
    Number.isFinite(candidate.lat) &&
    Number.isFinite(candidate.lng) &&
    candidate.lat >= -90 &&
    candidate.lat <= 90 &&
    candidate.lng >= -180 &&
    candidate.lng <= 180
  );
}

function clone(entry: RecentSearchEntry): RecentSearchEntry {
  return entry.coordinates ? { ...entry, coordinates: { ...entry.coordinates } } : { ...entry };
}

function normalizeStoredEntry(
  value: unknown,
  persistPreciseLocations: boolean
): RecentSearchEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RecentSearchEntry>;
  const query = safeText(candidate.query);
  const label = safeText(candidate.label);
  if (
    !query ||
    !label ||
    !isKind(candidate.kind) ||
    !Number.isSafeInteger(candidate.usedAt) ||
    (candidate.usedAt ?? -1) < 0
  ) {
    return null;
  }
  if (
    !persistPreciseLocations &&
    (PRECISE_KINDS.has(candidate.kind) || isPreciseLegacyQuery(query))
  ) {
    return null;
  }
  const coordinates = isCoordinates(candidate.coordinates)
    ? { ...candidate.coordinates }
    : undefined;
  return {
    id: entryId(candidate.kind, query),
    query,
    label,
    kind: candidate.kind,
    usedAt: candidate.usedAt!,
    ...(coordinates && persistPreciseLocations ? { coordinates } : {})
  };
}

function isPreciseLegacyQuery(value: string): boolean {
  return (
    parseCoordinates(value) !== null ||
    parseMapShareUrl(value) !== null ||
    /^(?:https?:\/\/|www\.)/i.test(value)
  );
}

export function createRecentSearchRepository(
  storage: KeyValueStorage,
  options: RecentSearchRepositoryOptions = {}
): RecentSearchRepository {
  const requestedMaximum = options.maxEntries ?? 12;
  const maxEntries = Number.isFinite(requestedMaximum)
    ? Math.min(50, Math.max(1, Math.floor(requestedMaximum)))
    : 12;
  const now = options.now ?? Date.now;
  const persistPreciseLocations = options.persistPreciseLocations === true;

  function timestamp(): number {
    const value = Math.floor(now());
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function readCurrent(): RecentSearchEntry[] | null {
    let raw: string | null;
    try {
      raw = storage.getItem(RECENT_SEARCHES_KEY);
    } catch {
      return [];
    }
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<RecentSearchEnvelope>;
      if (parsed.version !== RECENT_SEARCHES_VERSION || !Array.isArray(parsed.entries)) return [];
      const seen = new Set<string>();
      const entries: RecentSearchEntry[] = [];
      for (const item of parsed.entries) {
        const normalized = normalizeStoredEntry(item, persistPreciseLocations);
        const key = normalized?.query.toLocaleLowerCase("cs-CZ");
        if (!normalized || !key || seen.has(key)) continue;
        seen.add(key);
        entries.push(normalized);
        if (entries.length === maxEntries) break;
      }
      return entries.sort((a, b) => b.usedAt - a.usedAt);
    } catch {
      return [];
    }
  }

  function write(entries: readonly RecentSearchEntry[]): boolean {
    const envelope: RecentSearchEnvelope = {
      version: RECENT_SEARCHES_VERSION,
      entries: entries.slice(0, maxEntries).map(clone)
    };
    try {
      storage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(envelope));
      return true;
    } catch {
      return false;
    }
  }

  function migrateLegacy(): RecentSearchEntry[] {
    let raw: string | null;
    try {
      raw = storage.getItem(LEGACY_SEARCH_HISTORY_KEY);
    } catch {
      return [];
    }
    if (raw === null) return [];

    let legacy: unknown;
    try {
      legacy = JSON.parse(raw);
    } catch {
      legacy = [];
    }
    const entries: RecentSearchEntry[] = [];
    const seen = new Set<string>();
    if (Array.isArray(legacy)) {
      const baseTime = timestamp();
      for (const value of legacy) {
        const query = safeText(value);
        const key = query?.toLocaleLowerCase("cs-CZ");
        if (
          !query ||
          !key ||
          seen.has(key) ||
          (!persistPreciseLocations && isPreciseLegacyQuery(query))
        ) {
          continue;
        }
        seen.add(key);
        entries.push({
          id: entryId("place", query),
          query,
          label: query,
          kind: "place",
          usedAt: Math.max(0, baseTime - entries.length)
        });
        if (entries.length === maxEntries) break;
      }
    }

    if (write(entries)) {
      try {
        storage.removeItem(LEGACY_SEARCH_HISTORY_KEY);
      } catch {
        // The versioned data is already durable; a leftover legacy key is harmless.
      }
    }
    return entries.map(clone);
  }

  function list(): RecentSearchEntry[] {
    const current = readCurrent();
    return (current ?? migrateLegacy()).map(clone);
  }

  return {
    list,
    add(value) {
      const query = safeText(value.query);
      const label = safeText(value.label ?? value.query);
      if (!query || !label || !isKind(value.kind)) return list();
      if (
        !persistPreciseLocations &&
        (PRECISE_KINDS.has(value.kind) || isPreciseLegacyQuery(query))
      ) {
        return list();
      }

      const entries = list().filter(
        (entry) => entry.query.toLocaleLowerCase("cs-CZ") !== query.toLocaleLowerCase("cs-CZ")
      );
      const coordinates = isCoordinates(value.coordinates) ? { ...value.coordinates } : undefined;
      entries.unshift({
        id: entryId(value.kind, query),
        query,
        label,
        kind: value.kind,
        usedAt: timestamp(),
        ...(coordinates && persistPreciseLocations ? { coordinates } : {})
      });
      const next = entries.slice(0, maxEntries);
      write(next);
      return next.map(clone);
    },
    clear() {
      let success = true;
      for (const key of [RECENT_SEARCHES_KEY, LEGACY_SEARCH_HISTORY_KEY]) {
        try {
          storage.removeItem(key);
        } catch {
          success = false;
        }
      }
      return success;
    }
  };
}
