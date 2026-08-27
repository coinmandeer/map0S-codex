/**
 * What "most interesting places" is allowed to mean.
 *
 * The Discover panel used to take the first eight rows the database returned and call them the
 * most interesting — a claim backed by nothing. Ranking needs a signal, and the honest ones are
 * free and public:
 *
 * - **Wikipedia pageviews** — how many people actually read about the place. The closest open
 *   substitute for TripAdvisor's popularity, without its licence.
 * - **Wikidata sitelinks** — a castle written up in twenty languages outranks one written up in
 *   one. Cheap: one batched request covers fifty candidates.
 * - **OpenTripMap `rate`** (1–7) — an editorial score, ODbL so it can be cached. Its free tier
 *   is non-commercial, so it runs behind a capability flag and its absence just drops a term.
 *
 * A place with no signal at all is not thrown away — it sorts below the ones that have any,
 * which is the same thing the old code did, only now it is the fallback rather than the rule.
 */

import type { Bbox } from "@mapos/layer-sdk";
import { config } from "../config.js";
import { fetchJson } from "../utils/upstream.js";

export interface NotabilityCandidate {
  id: string;
  name: string | null;
  category: string;
  lng: number;
  lat: number;
  /** From OSM `wikidata` / `wikipedia` tags when the mapper added them. */
  wikidataId?: string;
  wikipediaTitle?: string;
}

export interface NotabilitySignals {
  pageviews?: number;
  sitelinks?: number;
  rate?: number;
}

export interface RankedPlace extends NotabilityCandidate {
  score: number;
  signals: NotabilitySignals;
}

/** Pageviews cost one request per article, so only the shortlist gets asked about. */
const PAGEVIEW_BUDGET = 12;
const SITELINK_BATCH = 50;
/** Two matches of the same place from different sources are within this distance of each other. */
const SAME_PLACE_M = 200;

function distanceM(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number }
): number {
  const dLat = (b.lat - a.lat) * 110_574;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface GeoSearchHit {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
}

/** Wikipedia's own view of what is here. One request covers the whole viewport, and the hits
 *  double as candidates in their own right — a place worth an article but missing from OSM
 *  still belongs in a list of interesting places. */
async function wikipediaNearby(bbox: Bbox, lang: string): Promise<GeoSearchHit[]> {
  const [west, south, east, north] = bbox;
  const lat = (south + north) / 2;
  const lng = (west + east) / 2;
  const radiusM = Math.min(10_000, Math.max(1_000, ((north - south) / 2) * 111_320));

  const data = await fetchJson<{ query?: { geosearch?: GeoSearchHit[] } }>(
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=geosearch&format=json&formatversion=2` +
      `&gscoord=${lat}|${lng}&gsradius=${Math.round(radiusM)}&gslimit=50`,
    { source: "Wikipedia", ttlMs: 60 * 60_000 }
  );
  return data.query?.geosearch ?? [];
}

interface EntitySitelinks {
  sitelinks?: Record<string, unknown>;
  labels?: Record<string, { value?: string }>;
}

async function sitelinkCounts(qids: string[], lang: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (let i = 0; i < qids.length; i += SITELINK_BATCH) {
    const batch = qids.slice(i, i + SITELINK_BATCH);
    try {
      const data = await fetchJson<{ entities?: Record<string, EntitySitelinks> }>(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&formatversion=2` +
          `&props=sitelinks&ids=${batch.join("|")}&languages=${lang}`,
        { source: "Wikidata", ttlMs: 24 * 60 * 60_000 }
      );
      for (const [qid, entity] of Object.entries(data.entities ?? {})) {
        counts.set(qid, Object.keys(entity.sitelinks ?? {}).length);
      }
    } catch {
      // No sitelinks just means this term drops out of the score.
    }
  }
  return counts;
}

function pageviewRange(days: number): { start: string; end: string } {
  const format = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const end = new Date(Date.now() - 2 * 86_400_000); // The API lags roughly a day.
  const start = new Date(end.getTime() - days * 86_400_000);
  return { start: format(start), end: format(end) };
}

async function monthlyPageviews(title: string, lang: string): Promise<number | undefined> {
  const { start, end } = pageviewRange(30);
  try {
    const data = await fetchJson<{ items?: Array<{ views?: number }> }>(
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/` +
        `${encodeURIComponent(title.replace(/ /g, "_"))}/daily/${start}/${end}`,
      { source: "Wikipedia Pageviews", ttlMs: 24 * 60 * 60_000 }
    );
    return (data.items ?? []).reduce((sum, item) => sum + (item.views ?? 0), 0);
  } catch {
    return undefined;
  }
}

interface OtmFeature {
  xid?: string;
  name?: string;
  rate?: number;
  point?: { lon?: number; lat?: number };
}

/** OpenTripMap's editorial rating. Behind a key because its free tier is non-commercial;
 *  without one the ranking falls back to the two keyless signals. */
async function openTripMapRates(bbox: Bbox): Promise<OtmFeature[]> {
  const key = config.layerKeys.opentripmap;
  if (!key) return [];
  const [west, south, east, north] = bbox;
  try {
    const data = await fetchJson<{ features?: Array<{ properties?: OtmFeature; geometry?: { coordinates?: [number, number] } }> }>(
      `https://api.opentripmap.com/0.1/en/places/bbox?lon_min=${west}&lon_max=${east}` +
        `&lat_min=${south}&lat_max=${north}&rate=2&format=geojson&limit=200&apikey=${encodeURIComponent(key)}`,
      { source: "OpenTripMap", ttlMs: 6 * 60 * 60_000 }
    );
    return (data.features ?? []).flatMap((f) => {
      const coords = f.geometry?.coordinates;
      if (!coords || !f.properties) return [];
      return [{ ...f.properties, point: { lon: coords[0], lat: coords[1] } }];
    });
  } catch {
    return [];
  }
}

/** Pageviews span orders of magnitude — a cathedral gets a hundred times a chapel's traffic —
 *  so the log keeps one landmark from flattening everything else to zero. */
function pageviewScore(views: number | undefined): number {
  if (!views) return 0;
  // A million monthly views is the top of the scale; the biggest landmark in Europe is around
  // there, so saturating earlier would tie it with every merely popular castle.
  return Math.min(1, Math.log10(views + 1) / 6);
}

export interface RankOptions {
  bbox: Bbox;
  lang?: string;
  limit?: number;
  /** Test seam: the three upstreams, so ranking can be exercised without the network. */
  signals?: Partial<{
    nearbyArticles(bbox: Bbox, lang: string): Promise<GeoSearchHit[]>;
    sitelinks(qids: string[], lang: string): Promise<Map<string, number>>;
    rates(bbox: Bbox): Promise<OtmFeature[]>;
    pageviews(title: string, lang: string): Promise<number | undefined>;
  }>;
}

export async function rankByNotability(
  candidates: NotabilityCandidate[],
  { bbox, lang = "cs", limit = 12, signals: overrides = {} }: RankOptions
): Promise<RankedPlace[]> {
  const nearbyArticles = overrides.nearbyArticles ?? wikipediaNearby;
  const sitelinksOf = overrides.sitelinks ?? sitelinkCounts;
  const ratesOf = overrides.rates ?? openTripMapRates;
  const pageviewsOf = overrides.pageviews ?? monthlyPageviews;

  const [wikiHits, otm] = await Promise.all([
    nearbyArticles(bbox, lang).catch(() => [] as GeoSearchHit[]),
    ratesOf(bbox)
  ]);

  const pool: NotabilityCandidate[] = [...candidates];

  // Wikipedia articles nobody has mapped are still places worth seeing, so unmatched hits join
  // the pool rather than only annotating it.
  const byNormalizedName = new Map(
    candidates.filter((c) => c.name).map((c) => [normalizeName(c.name!), c])
  );
  for (const hit of wikiHits) {
    const match =
      byNormalizedName.get(normalizeName(hit.title)) ??
      candidates.find((c) => distanceM(c, { lng: hit.lon, lat: hit.lat }) < SAME_PLACE_M);
    if (match) {
      match.wikipediaTitle ??= hit.title;
    } else {
      pool.push({
        id: `wiki-${hit.pageid}`,
        name: hit.title,
        category: "wikipedia",
        lng: hit.lon,
        lat: hit.lat,
        wikipediaTitle: hit.title
      });
    }
  }

  const sitelinks = await sitelinksOf(
    [...new Set(pool.flatMap((c) => (c.wikidataId ? [c.wikidataId] : [])))],
    lang
  );

  const scored: RankedPlace[] = pool.map((candidate) => {
    const signals: NotabilitySignals = {};
    if (candidate.wikidataId) signals.sitelinks = sitelinks.get(candidate.wikidataId);

    const rated = otm.find(
      (f) =>
        f.point?.lon !== undefined &&
        f.point.lat !== undefined &&
        distanceM(candidate, { lng: f.point.lon, lat: f.point.lat }) < SAME_PLACE_M
    );
    if (rated?.rate) signals.rate = rated.rate;

    return { ...candidate, signals, score: scoreOf(signals, Boolean(candidate.wikipediaTitle)) };
  });

  // Pageviews are the strongest signal and the most expensive, so they are only spent on the
  // shortlist the cheap signals already agree about.
  const shortlist = [...scored].sort((a, b) => b.score - a.score).slice(0, PAGEVIEW_BUDGET);
  await Promise.all(
    shortlist.map(async (place) => {
      if (!place.wikipediaTitle) return;
      place.signals.pageviews = await pageviewsOf(place.wikipediaTitle, lang);
      place.score = scoreOf(place.signals, true);
    })
  );

  return scored
    .sort((a, b) => b.score - a.score || (a.name ?? "").localeCompare(b.name ?? ""))
    .slice(0, limit);
}

/** Each signal contributes on its own scale; a place having any of them beats a place having
 *  none, which is the whole point compared to the unordered list this replaces. */
export function scoreOf(signals: NotabilitySignals, hasArticle = false): number {
  return (
    pageviewScore(signals.pageviews) * 3 +
    Math.min(1, (signals.sitelinks ?? 0) / 25) * 2 +
    ((signals.rate ?? 0) / 7) * 2 +
    (hasArticle ? 0.25 : 0)
  );
}

export const __testing = { normalizeName, distanceM, pageviewScore };
