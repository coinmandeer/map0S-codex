/** Content for the place detail's API panels.
 *
 *  These go through the server rather than straight from the browser for three reasons that
 *  apply to every one of them: the upstreams want a User-Agent identifying the caller, the same
 *  place gets opened repeatedly so the answers are worth caching, and a browser-side key would
 *  not be a key at all.
 */

import { fetchJson } from "../utils/upstream.js";
import { monthlyClimateNormals, type ClimateNormals } from "./climateService.js";

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

async function wikipediaSummary(
  lang: string,
  title: string,
  signal?: AbortSignal
): Promise<WikipediaArticle | null> {
  try {
    const data = await fetchJson<{
      title?: string;
      extract?: string;
      type?: string;
      content_urls?: { desktop?: { page?: string } };
      thumbnail?: { source?: string };
    }>(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`,
      { providerId: "wikipedia", ttlMs: 6 * 3600_000, signal }
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
async function titlesFromQid(
  qid: string,
  signal?: AbortSignal
): Promise<Array<{ lang: string; title: string }>> {
  const data = await fetchJson<{
    entities?: Record<string, { sitelinks?: Record<string, { title?: string }> }>;
  }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks&format=json&origin=*`,
    { providerId: "wikidata", ttlMs: 24 * 3600_000, minIntervalMs: 150, retries: 2, signal }
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
  signal?: AbortSignal;
}): Promise<WikipediaArticle | null> {
  const candidates: Array<{ lang: string; title: string }> = [];

  if (input.qid && /^Q\d+$/.test(input.qid)) {
    try {
      candidates.push(...(await titlesFromQid(input.qid, input.signal)));
    } catch {
      /* fall through to the name-based attempt */
    }
  }
  if (input.title) {
    const langs = input.lang ? [input.lang, ...WIKI_LANGS] : WIKI_LANGS;
    for (const lang of [...new Set(langs)]) candidates.push({ lang, title: input.title });
  }

  for (const candidate of candidates) {
    input.signal?.throwIfAborted();
    const article = await wikipediaSummary(candidate.lang, candidate.title, input.signal);
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
    { providerId: "wikidata", ttlMs: 24 * 3600_000, minIntervalMs: 150, retries: 2 }
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
        {
          providerId: "wikidata",
          ttlMs: 7 * 24 * 3600_000,
          minIntervalMs: 150,
          retries: 2
        }
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
  current: {
    temperature: number | null;
    windSpeed: number | null;
    windDirection: number | null;
    code: number | null;
  } | null;
  hourly: Array<{
    time: string;
    temperature: number | null;
    precipitation: number | null;
    code: number | null;
  }>;
  daily: Array<{
    date: string;
    min: number | null;
    max: number | null;
    precipitation: number | null;
    code: number | null;
  }>;
  source: {
    id: "open-meteo-forecast";
    label: "Open-Meteo Forecast API";
    url: "https://open-meteo.com/";
    license: "CC BY 4.0";
  };
  /** Long-term monthly temperature normals from the ERA5 archive (1991–2020). Never inferred
   * from the seven-day forecast; the period and source are part of the payload. */
  climate: ClimateNormals;
}

/** Open-Meteo hosted free access is for noncommercial use; mapOS uses it within the configured free limits. */
export async function getPointForecast(lng: number, lat: number): Promise<PointForecast> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code` +
    `&hourly=temperature_2m,precipitation,weather_code&forecast_hours=168` +
    `&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,weather_code&forecast_days=7` +
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
  }>(url, { providerId: "open-meteo", ttlMs: 30 * 60_000 });

  const hourlyTimes = data.hourly?.time ?? [];
  const dailyTimes = data.daily?.time ?? [];
  const numberOrNull = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  // Monthly normals come from the separate archive adapter. A failure there must not cost the
  // reader the forecast they came for, so the climate block degrades on its own.
  const climate = await monthlyClimateNormals(lng, lat);

  return {
    current: data.current
      ? {
          temperature: numberOrNull(data.current.temperature_2m),
          windSpeed: numberOrNull(data.current.wind_speed_10m),
          windDirection: numberOrNull(data.current.wind_direction_10m),
          code: numberOrNull(data.current.weather_code)
        }
      : null,
    hourly: hourlyTimes.slice(0, 168).map((time, i) => ({
      time,
      temperature: numberOrNull(data.hourly?.temperature_2m?.[i]),
      precipitation: numberOrNull(data.hourly?.precipitation?.[i]),
      code: numberOrNull(data.hourly?.weather_code?.[i])
    })),
    daily: dailyTimes.slice(0, 7).map((date, i) => ({
      date,
      min: numberOrNull(data.daily?.temperature_2m_min?.[i]),
      max: numberOrNull(data.daily?.temperature_2m_max?.[i]),
      precipitation: numberOrNull(data.daily?.precipitation_sum?.[i]),
      code: numberOrNull(data.daily?.weather_code?.[i])
    })),
    source: {
      id: "open-meteo-forecast",
      label: "Open-Meteo Forecast API",
      url: "https://open-meteo.com/",
      license: "CC BY 4.0"
    },
    climate
  };
}

export { getFoursquareDetail, type FoursquareDetail } from "./foursquarePlaces.js";
