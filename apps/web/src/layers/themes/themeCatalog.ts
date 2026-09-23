/**
 * Talking to `/v2/themes`.
 *
 * Kept apart from the section that renders it so the excluded-source rules are testable without
 * a DOM: which sources a request carries, and what a bbox looks like on the wire, are the two
 * things most likely to go quietly wrong.
 */

import { activeLocale } from "../../i18n";
import { apiGet } from "../../lib/api";
import type { ChoroplethBreak } from "./choropleth";
import { themeQuery, type ThemeDetail, type ThemeSummary } from "./themeLayers";

export interface ThemeViewportSource {
  datasetId: string;
  name: string;
  role: string;
  geoLevel: string;
  attribution: string;
  license: string;
  documentationUrl: string;
  share: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  units: number;
}

export interface ThemeUnitDetail {
  themeId: string;
  code: string;
  name: string;
  geoLevel: string;
  unit: string;
  period: string;
  flag?: string;
  value: number | null;
  rank: number | null;
  of: number;
  series: Array<{ period: string; value: number | null; flag?: string }>;
  source: { datasetId: string; name: string; attribution: string };
}

export async function fetchThemeSummaries(
  signal?: AbortSignal,
  bbox?: readonly number[],
  zoom?: number
): Promise<ThemeSummary[]> {
  const data = await apiGet<{ themes: ThemeSummary[] }>(
    `/v2/themes?lang=${activeLocale()}${bbox ? `&bbox=${bbox.map(round).join(",")}&zoom=${zoom ?? 0}` : ""}`,
    {
      signal
    }
  );
  return data.themes;
}

/** `lang` appended to a query that may already have one parameter, or may have none.
 *
 *  Only metadata carries it. A tile is numbers and geometry with no words in it, so adding a
 *  language to a tile URL would halve the cache hit rate and change nothing on screen. */
function withLang(query: string): string {
  return query ? `${query}&lang=${activeLocale()}` : `?lang=${activeLocale()}`;
}

export async function fetchThemeDetail(
  id: string,
  options: {
    period?: string;
    excluded?: readonly string[];
    signal?: AbortSignal;
    zoom?: number;
  } = {}
): Promise<ThemeDetail> {
  const detail = await apiGet<Omit<ThemeDetail, "excluded"> & { breaks: ChoroplethBreak[] }>(
    `/v2/themes/${encodeURIComponent(id)}${withLang(themeQuery(options))}`,
    { signal: options.signal }
  );
  // The exclusions travel back with the detail so the layer's tile URL and the legend that
  // describes it are built from one object; splitting them is how a legend ends up describing
  // colours from a source the map no longer draws.
  return { ...detail, excluded: [...(options.excluded ?? [])] };
}

export async function fetchThemeSources(
  id: string,
  bbox: readonly [number, number, number, number],
  signal?: AbortSignal
): Promise<ThemeViewportSource[]> {
  const data = await apiGet<{ sources: ThemeViewportSource[] }>(
    `/v2/themes/${encodeURIComponent(id)}/sources?bbox=${bbox.map(round).join(",")}` +
      `&lang=${activeLocale()}`,
    { signal }
  );
  return data.sources;
}

export async function fetchThemeUnit(
  id: string,
  geoLevel: string,
  code: string,
  options: {
    period?: string;
    excluded?: readonly string[];
    signal?: AbortSignal;
    zoom?: number;
  } = {}
): Promise<ThemeUnitDetail> {
  return apiGet<ThemeUnitDetail>(
    `/v2/themes/${encodeURIComponent(id)}/units/${encodeURIComponent(geoLevel)}/` +
      `${encodeURIComponent(code)}${withLang(themeQuery(options))}`,
    { signal: options.signal }
  );
}

/** Five decimals is roughly a metre, and it keeps the URL out of cache-busting territory: a
 *  pan of half a pixel should hit the same cached answer as the pan before it. */
function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
