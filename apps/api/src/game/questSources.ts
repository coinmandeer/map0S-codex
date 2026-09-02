/**
 * Quest anchors from the open geo-gaming and mapping world.
 *
 * Every source here has terms a fork can actually satisfy: no partner programme, no signed
 * master agreement, no mandatory branding. That rules out geocaching.com — its API is closed to
 * small projects — which is why the caches below come from the Opencaching network instead.
 *
 * Two of these produce quests that improve the map itself rather than only the game: a monument
 * with no photo and an unresolved OSM note are real gaps, and walking to them fixes something.
 */

import type { Bbox } from "@mapos/layer-sdk";
import { config } from "../config.js";
import { fetchJson } from "../utils/upstream.js";
import { registerQuestSource, type QuestAnchor, type QuestSourceAdapter } from "./anchors.js";

interface OkapiCache {
  code: string;
  name?: string;
  location?: string;
  type?: string;
  difficulty?: number;
  terrain?: number;
  url?: string;
  status?: string;
}

function parseOkapiLocation(location: string | undefined): { lng: number; lat: number } | null {
  // OKAPI returns "lat|lon".
  const [lat, lng] = (location ?? "").split("|").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lng: lng!, lat: lat! };
}

function okapiAnchor(instanceCode: string, cache: OkapiCache): QuestAnchor | null {
  const at = parseOkapiLocation(cache.location);
  if (!at || !cache.name) return null;
  return {
    ref: `oc:${instanceCode}:${cache.code}`,
    name: cache.name,
    lng: at.lng,
    lat: at.lat,
    category: "geocache",
    kind: "cache",
    // The Opencaching licence requires a clickable link to the individual cache, so this is a
    // condition of use rather than a nicety.
    externalUrl:
      cache.url ??
      `https://${instanceCode === "uk" ? "opencache.uk" : `opencaching.${instanceCode}`}/viewcache.php?wp=${cache.code}`,
    weight: 2 + (cache.difficulty ?? 1) / 2 + (cache.terrain ?? 1) / 2,
    // A cache is hidden, so "there" has to be tighter than for a castle.
    radiusM: 60,
    description: `Keš ${cache.code} · obtížnost ${cache.difficulty ?? "?"}/terén ${cache.terrain ?? "?"}`
  };
}

const OKAPI_FIELDS = "code|name|location|type|difficulty|terrain|url|status";

/** Opencaching — the open-licensed geocaching network, one API per country. */
export const opencaching: QuestSourceAdapter = {
  id: "opencaching",
  label: "Opencaching",
  attribution: "Opencaching (CC-BY-SA / CC-BY-NC-ND dle instance)",
  unavailableReason: () =>
    config.okapiInstances.length
      ? null
      : "Chybí OKAPI klíč — zaregistruj se na opencaching.de nebo .pl",

  async anchors(bbox, limit) {
    const [west, south, east, north] = bbox;
    const instances = config.okapiInstances;

    const perInstance = await Promise.all(
      instances.map(async ({ code, host, key }) => {
        try {
          const search = await fetchJson<{ results?: string[] }>(
            `https://${host}/okapi/services/caches/search/bbox` +
              `?bbox=${south}|${west}|${north}|${east}&status=Available&limit=${limit}` +
              `&consumer_key=${encodeURIComponent(key)}`,
            { providerId: "opencaching", ttlMs: 30 * 60_000 }
          );
          const codes = (search.results ?? []).slice(0, limit);
          if (!codes.length) return [];

          const details = await fetchJson<Record<string, OkapiCache>>(
            `https://${host}/okapi/services/caches/geocaches` +
              `?cache_codes=${codes.join("|")}&fields=${encodeURIComponent(OKAPI_FIELDS)}` +
              `&consumer_key=${encodeURIComponent(key)}`,
            { providerId: "opencaching", ttlMs: 30 * 60_000 }
          );

          return Object.values(details).flatMap((cache) => {
            const anchor = okapiAnchor(code, cache);
            return anchor ? [anchor] : [];
          });
        } catch {
          return [];
        }
      })
    );

    return perInstance.flat();
  },

  async resolve(ref) {
    const [, instanceCode, cacheCode] = ref.split(":");
    if (!instanceCode || !cacheCode) return null;
    const instance = config.okapiInstances.find((i) => i.code === instanceCode);
    if (!instance) return null;

    const details = await fetchJson<Record<string, OkapiCache>>(
      `https://${instance.host}/okapi/services/caches/geocaches` +
        `?cache_codes=${encodeURIComponent(cacheCode)}&fields=${encodeURIComponent(OKAPI_FIELDS)}` +
        `&consumer_key=${encodeURIComponent(instance.key)}`,
      { providerId: "opencaching", ttlMs: 30 * 60_000 }
    );
    const cache = details[cacheCode];
    return cache ? okapiAnchor(instanceCode, cache) : null;
  }
};

interface WlmMonument {
  id?: string;
  name?: string;
  lat?: number | string;
  lon?: number | string;
  country?: string;
  image?: string;
  source?: string;
  monument_article?: string;
}

function wlmAnchor(m: WlmMonument): QuestAnchor | null {
  const lat = Number(m.lat);
  const lng = Number(m.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !m.name || !m.id) return null;
  return {
    ref: `wlm:${m.country ?? "xx"}:${m.id}`,
    name: m.name,
    lng,
    lat,
    category: "monument",
    kind: "photo",
    weight: 3,
    radiusM: 120,
    description: "Tahle památka nemá fotku. Vyfoť ji a nahraj na Wikimedia Commons.",
    externalUrl: "https://commons.wikimedia.org/wiki/Commons:Upload"
  };
}

/** Wiki Loves Monuments, filtered to monuments with no photograph. A quest that produces a
 *  freely licensed picture of a listed building is worth more than one that produces a tick. */
export const monumentsWithoutPhoto: QuestSourceAdapter = {
  id: "wlm-photo",
  label: "Památky bez fotky",
  attribution: "Wiki Loves Monuments · heritage.toolforge.org (CC0)",

  async anchors(bbox, limit) {
    const [west, south, east, north] = bbox;
    const data = await fetchJson<{ monuments?: WlmMonument[] }>(
      `https://heritage.toolforge.org/api/api.php?action=search&format=json` +
        `&bbox=${west}|${south}|${east}|${north}&limit=${limit * 3}&props=id|name|lat|lon|image|country|source`,
      { providerId: "wikilovesmonuments", ttlMs: 60 * 60_000 }
    );

    return (data.monuments ?? [])
      .filter((m) => !m.image)
      .flatMap((m) => {
        const anchor = wlmAnchor(m);
        return anchor ? [anchor] : [];
      })
      .slice(0, limit);
  },

  async resolve(ref) {
    const [, country, id] = ref.split(":");
    if (!country || !id) return null;
    const data = await fetchJson<{ monuments?: WlmMonument[] }>(
      `https://heritage.toolforge.org/api/api.php?action=search&format=json` +
        `&srcountry=${encodeURIComponent(country)}&id=${encodeURIComponent(id)}&limit=1` +
        `&props=id|name|lat|lon|image|country|source`,
      { providerId: "wikilovesmonuments", ttlMs: 60 * 60_000 }
    );
    const monument = data.monuments?.[0];
    return monument ? wlmAnchor(monument) : null;
  }
};

interface OsmNote {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    id?: number;
    status?: string;
    comments?: Array<{ text?: string; action?: string }>;
  };
}

function osmNoteAnchor(note: OsmNote): QuestAnchor | null {
  const coords = note.geometry?.coordinates;
  const id = note.properties?.id;
  if (!coords || id === undefined) return null;
  const question = note.properties?.comments?.[0]?.text?.trim();
  return {
    ref: `osmnote:${id}`,
    // A note's first comment is the question somebody left; truncated because some are essays.
    name: question ? question.slice(0, 60) : `Poznámka #${id}`,
    lng: coords[0],
    lat: coords[1],
    category: "survey",
    kind: "survey",
    weight: 2,
    radiusM: 100,
    description: "Někdo tady potřebuje ověřit informaci v mapě. Zajdi tam a doplň ji.",
    externalUrl: `https://www.openstreetmap.org/note/${id}`
  };
}

/** Unresolved OSM notes — the "somebody should check this" queue of the map itself, which is
 *  exactly the StreetComplete loop with a different front end. */
export const osmNotes: QuestSourceAdapter = {
  id: "osm-notes",
  label: "Poznámky v OSM",
  attribution: "© OpenStreetMap přispěvatelé (ODbL)",

  async anchors(bbox, limit) {
    const data = await fetchJson<{ features?: OsmNote[] }>(
      `https://api.openstreetmap.org/api/0.6/notes.json?bbox=${bbox.join(",")}&limit=${Math.min(limit * 2, 100)}&closed=0`,
      { providerId: "osm-notes", ttlMs: 15 * 60_000 }
    );
    return (data.features ?? [])
      .flatMap((n) => {
        const anchor = osmNoteAnchor(n);
        return anchor ? [anchor] : [];
      })
      .slice(0, limit);
  },

  async resolve(ref) {
    const id = ref.split(":")[1];
    if (!id) return null;
    const note = await fetchJson<OsmNote>(
      `https://api.openstreetmap.org/api/0.6/notes/${encodeURIComponent(id)}.json`,
      { providerId: "osm-notes", ttlMs: 15 * 60_000 }
    );
    // A closed note has been answered by somebody else; the quest is gone with it.
    if (note.properties?.status === "closed") return null;
    return osmNoteAnchor(note);
  }
};

interface TurfZone {
  id?: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  totalTakeovers?: number;
  pointsPerHour?: number;
  takeoverPoints?: number;
  region?: { name?: string; country?: string };
}

function turfAnchor(zone: TurfZone): QuestAnchor | null {
  if (!zone.name || zone.latitude === undefined || zone.longitude === undefined) return null;
  return {
    ref: `turf:${zone.name}`,
    name: zone.name,
    lng: zone.longitude,
    lat: zone.latitude,
    category: "territory",
    kind: "territory",
    weight: 1 + Math.min(4, (zone.pointsPerHour ?? 0) / 5),
    radiusM: 100,
    description: `Zóna Turf · ${zone.pointsPerHour ?? 0} bodů/h · ${zone.totalTakeovers ?? 0} záborů`,
    externalUrl: `https://turfgame.com/zone/${encodeURIComponent(zone.name)}`
  };
}

/**
 * Turf Game zones — a real territory-capture game with a public, keyless API.
 *
 * Its bbox endpoint takes a POST body. The shared transport supports bounded JSON POSTs, and the
 * coarse viewport cache below prevents camera movement from multiplying requests.
 */
export const turfZones: QuestSourceAdapter = {
  id: "turf-zones",
  label: "Turf zóny",
  attribution: "Turf Game (api.turfgame.com)",

  async anchors(bbox, limit) {
    const zones = await turfZonesForBbox(bbox);
    return zones
      .flatMap((z) => {
        const anchor = turfAnchor(z);
        return anchor ? [anchor] : [];
      })
      .slice(0, limit);
  },

  async resolve(ref) {
    const name = ref.slice("turf:".length);
    if (!name) return null;
    const zones = await turfRequest<TurfZone[]>("/v5/zones", [{ name }]);
    const zone = zones.find((z) => z.name === name);
    return zone ? turfAnchor(zone) : null;
  }
};

const turfCache = new Map<string, { zones: TurfZone[]; expiresAt: number }>();

async function turfZonesForBbox(bbox: Bbox): Promise<TurfZone[]> {
  const [west, south, east, north] = bbox;
  // Cached per coarse tile rather than per exact viewport: Turf's limits do not survive a
  // request per camera nudge, and zone positions never move.
  const key = [west, south, east, north].map((n) => n.toFixed(1)).join(",");
  const hit = turfCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.zones;

  const zones = await turfRequest<TurfZone[]>("/v5/zones", [
    {
      northEast: { latitude: north, longitude: east },
      southWest: { latitude: south, longitude: west }
    }
  ]);

  turfCache.set(key, { zones, expiresAt: Date.now() + 60 * 60_000 });
  return zones;
}

async function turfRequest<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(`https://api.turfgame.com${path}`, {
    providerId: "turf",
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    ttlMs: 60 * 60_000,
    timeoutMs: 12_000,
    maxResponseBytes: 2 * 1024 * 1024
  });
}

export const externalQuestSources: QuestSourceAdapter[] = [
  opencaching,
  monumentsWithoutPhoto,
  osmNotes,
  turfZones
];

export function registerExternalQuestSources(): void {
  externalQuestSources.forEach(registerQuestSource);
}

export const __testing = { okapiAnchor, wlmAnchor, osmNoteAnchor, turfAnchor, turfCache };
