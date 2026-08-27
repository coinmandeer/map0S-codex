/** Content for the place detail's API panels.
 *
 *  These go through the server rather than straight from the browser for three reasons that
 *  apply to every one of them: the upstreams want a User-Agent identifying the caller, the same
 *  place gets opened repeatedly so the answers are worth caching, and a browser-side key would
 *  not be a key at all.
 */

import { config } from "../config.js";
import { fetchJson } from "../utils/upstream.js";

export interface WikipediaArticle {
  lang: string;
  title: string;
  extract: string;
  url: string;
  thumbnail: string | null;
}

/** Languages tried in order. A Czech article is preferred where it exists; English is the
 *  fallback with the widest coverage; German fills gaps in Central European heritage articles. */
const WIKI_LANGS = ["cs", "en", "de"];

async function wikipediaSummary(lang: string, title: string): Promise<WikipediaArticle | null> {
  try {
    const data = await fetchJson<{
      title?: string;
      extract?: string;
      type?: string;
      content_urls?: { desktop?: { page?: string } };
      thumbnail?: { source?: string };
    }>(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`,
      { source: "wikipedia", ttlMs: 6 * 3600_000 }
    );
    // Disambiguation pages are technically a hit but tell the reader nothing about the place.
    if (!data.extract || data.type === "disambiguation") return null;
    return {
      lang,
      title: data.title ?? title,
      extract: data.extract,
      url:
        data.content_urls?.desktop?.page ??
        `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      thumbnail: data.thumbnail?.source ?? null
    };
  } catch {
    return null;
  }
}

/** Wikidata knows which article in which language describes a QID, which is far more reliable
 *  than searching Wikipedia for the place's name and hoping the top hit is the right one. */
async function titlesFromQid(qid: string): Promise<Array<{ lang: string; title: string }>> {
  const data = await fetchJson<{
    entities?: Record<string, { sitelinks?: Record<string, { title?: string }> }>;
  }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks&format=json&origin=*`,
    { source: "wikidata", ttlMs: 24 * 3600_000 }
  );
  const sitelinks = data.entities?.[qid]?.sitelinks ?? {};
  return WIKI_LANGS.map((lang) => ({ lang, title: sitelinks[`${lang}wiki`]?.title ?? "" })).filter(
    (entry) => entry.title
  );
}

export async function getWikipediaArticle(input: {
  qid?: string;
  title?: string;
  lang?: string;
}): Promise<WikipediaArticle | null> {
  const candidates: Array<{ lang: string; title: string }> = [];

  if (input.qid && /^Q\d+$/.test(input.qid)) {
    try {
      candidates.push(...(await titlesFromQid(input.qid)));
    } catch {
      /* fall through to the name-based attempt */
    }
  }
  if (input.title) {
    const langs = input.lang ? [input.lang, ...WIKI_LANGS] : WIKI_LANGS;
    for (const lang of [...new Set(langs)]) candidates.push({ lang, title: input.title });
  }

  for (const candidate of candidates) {
    const article = await wikipediaSummary(candidate.lang, candidate.title);
    if (article) return article;
  }
  return null;
}

export interface WikidataFacts {
  qid: string;
  label: string;
  description: string | null;
  url: string;
  /** Human-readable statements, already resolved from QIDs to labels. */
  facts: Array<{ label: string; value: string }>;
  /** Number of language editions with an article — a rough but effective notability signal. */
  sitelinks: number;
}

/** Properties worth showing about a place, in the order a reader would want them. Anything else
 *  Wikidata holds is noise in a map popup. */
const WIKIDATA_PROPS: Record<string, string> = {
  P31: "Je",
  P17: "Země",
  P571: "Založeno",
  P84: "Architekt",
  P149: "Sloh",
  P2048: "Výška",
  P1082: "Obyvatel",
  P856: "Web"
};

type Snak = {
  mainsnak?: {
    datatype?: string;
    datavalue?: { type?: string; value?: unknown };
  };
};

function formatTime(value: string): string {
  const match = value.match(/^[+-](\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const [, year, month, day] = match;
  return month === "00" || day === "00" ? year! : `${Number(day)}. ${Number(month)}. ${year}`;
}

export async function getWikidataFacts(qid: string): Promise<WikidataFacts | null> {
  if (!/^Q\d+$/.test(qid)) return null;
  const data = await fetchJson<{
    entities?: Record<
      string,
      {
        labels?: Record<string, { value: string }>;
        descriptions?: Record<string, { value: string }>;
        claims?: Record<string, Snak[]>;
        sitelinks?: Record<string, unknown>;
      }
    >;
  }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels|descriptions|claims|sitelinks&languages=cs|en|de&format=json&origin=*`,
    { source: "wikidata", ttlMs: 24 * 3600_000 }
  );

  const entity = data.entities?.[qid];
  if (!entity) return null;

  const pick = (map: Record<string, { value: string }> | undefined) =>
    map?.cs?.value ?? map?.en?.value ?? map?.de?.value ?? null;

  const referencedQids = new Set<string>();
  const raw: Array<{ label: string; value: string; qid?: string }> = [];

  for (const [prop, label] of Object.entries(WIKIDATA_PROPS)) {
    const snak = entity.claims?.[prop]?.[0]?.mainsnak;
    const value = snak?.datavalue?.value;
    if (value === undefined) continue;

    if (snak?.datavalue?.type === "wikibase-entityid") {
      const id = (value as { id?: string }).id;
      if (!id) continue;
      referencedQids.add(id);
      raw.push({ label, value: id, qid: id });
    } else if (snak?.datavalue?.type === "time") {
      raw.push({ label, value: formatTime((value as { time: string }).time) });
    } else if (snak?.datavalue?.type === "quantity") {
      raw.push({ label, value: (value as { amount: string }).amount.replace(/^\+/, "") });
    } else if (typeof value === "string") {
      raw.push({ label, value });
    }
  }

  // Referenced entities come back as QIDs; one extra batched call turns them into words.
  const labels = new Map<string, string>();
  if (referencedQids.size) {
    try {
      const ids = [...referencedQids].join("|");
      const resolved = await fetchJson<{
        entities?: Record<string, { labels?: Record<string, { value: string }> }>;
      }>(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=labels&languages=cs|en|de&format=json&origin=*`,
        { source: "wikidata", ttlMs: 7 * 24 * 3600_000 }
      );
      for (const [id, ent] of Object.entries(resolved.entities ?? {})) {
        const label = pick(ent.labels);
        if (label) labels.set(id, label);
      }
    } catch {
      /* QIDs stay as-is rather than dropping the fact entirely */
    }
  }

  return {
    qid,
    label: pick(entity.labels) ?? qid,
    description: pick(entity.descriptions),
    url: `https://www.wikidata.org/wiki/${qid}`,
    sitelinks: Object.keys(entity.sitelinks ?? {}).length,
    facts: raw.map((f) => ({
      label: f.label,
      value: f.qid ? (labels.get(f.qid) ?? f.value) : f.value
    }))
  };
}

export interface PointForecast {
  current: { temperature: number; windSpeed: number; windDirection: number; code: number } | null;
  hourly: Array<{ time: string; temperature: number; precipitation: number; code: number }>;
  daily: Array<{ date: string; min: number; max: number; precipitation: number; code: number }>;
}

/** Open-Meteo needs no key and allows commercial use below 10k calls a day, which is why the
 *  weather panel works out of the box while the tile overlays need OpenWeatherMap. */
export async function getPointForecast(lng: number, lat: number): Promise<PointForecast> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code` +
    `&hourly=temperature_2m,precipitation,weather_code&forecast_hours=24` +
    `&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,weather_code&forecast_days=5` +
    `&timezone=auto`;

  const data = await fetchJson<{
    current?: {
      temperature_2m?: number;
      wind_speed_10m?: number;
      wind_direction_10m?: number;
      weather_code?: number;
    };
    hourly?: {
      time?: string[];
      temperature_2m?: number[];
      precipitation?: number[];
      weather_code?: number[];
    };
    daily?: {
      time?: string[];
      temperature_2m_min?: number[];
      temperature_2m_max?: number[];
      precipitation_sum?: number[];
      weather_code?: number[];
    };
  }>(url, { source: "open-meteo", ttlMs: 30 * 60_000 });

  const hourlyTimes = data.hourly?.time ?? [];
  const dailyTimes = data.daily?.time ?? [];

  return {
    current: data.current
      ? {
          temperature: data.current.temperature_2m ?? 0,
          windSpeed: data.current.wind_speed_10m ?? 0,
          windDirection: data.current.wind_direction_10m ?? 0,
          code: data.current.weather_code ?? 0
        }
      : null,
    hourly: hourlyTimes.slice(0, 24).map((time, i) => ({
      time,
      temperature: data.hourly?.temperature_2m?.[i] ?? 0,
      precipitation: data.hourly?.precipitation?.[i] ?? 0,
      code: data.hourly?.weather_code?.[i] ?? 0
    })),
    daily: dailyTimes.slice(0, 5).map((date, i) => ({
      date,
      min: data.daily?.temperature_2m_min?.[i] ?? 0,
      max: data.daily?.temperature_2m_max?.[i] ?? 0,
      precipitation: data.daily?.precipitation_sum?.[i] ?? 0,
      code: data.daily?.weather_code?.[i] ?? 0
    }))
  };
}

export interface FoursquareDetail {
  fsqId: string;
  name: string | null;
  rating: number | null;
  ratingCount: number | null;
  price: number | null;
  hours: string | null;
  categories: string[];
  photos: string[];
  tips: Array<{ text: string }>;
  url: string;
}

export async function getFoursquareDetail(fsqId: string): Promise<FoursquareDetail | null> {
  const key = config.fsqKey;
  if (!key || !/^[\w-]+$/.test(fsqId)) return null;

  const headers = { Authorization: key };
  const [details, photos, tips] = await Promise.all([
    fetchJson<{
      name?: string;
      rating?: number;
      price?: number;
      stats?: { total_ratings?: number };
      hours?: { display?: string };
      categories?: Array<{ name?: string }>;
    }>(
      `https://api.foursquare.com/v3/places/${fsqId}?fields=name,rating,price,stats,hours,categories`,
      { source: "foursquare", headers, ttlMs: 6 * 3600_000 }
    ).catch(() => null),
    fetchJson<Array<{ prefix: string; suffix: string }>>(
      `https://api.foursquare.com/v3/places/${fsqId}/photos?limit=6`,
      { source: "foursquare", headers, ttlMs: 6 * 3600_000 }
    ).catch(() => []),
    fetchJson<Array<{ text: string }>>(
      `https://api.foursquare.com/v3/places/${fsqId}/tips?limit=5`,
      { source: "foursquare", headers, ttlMs: 6 * 3600_000 }
    ).catch(() => [])
  ]);

  if (!details) return null;
  return {
    fsqId,
    name: details.name ?? null,
    rating: details.rating ?? null,
    ratingCount: details.stats?.total_ratings ?? null,
    price: details.price ?? null,
    hours: details.hours?.display ?? null,
    categories: (details.categories ?? [])
      .map((c) => c.name)
      .filter((n): n is string => Boolean(n)),
    photos: (photos ?? []).map((p) => `${p.prefix}400x400${p.suffix}`),
    tips: (tips ?? []).filter((t) => t.text).map((t) => ({ text: t.text })),
    url: `https://foursquare.com/v/${fsqId}`
  };
}
