import { STAT_DATASETS, type StatDatasetDescriptor } from "@mapos/adapter-sdk";
import { isMapResultArtifact, type MapResultDraft } from "@mapos/layer-sdk";
import { sql } from "../../db/index.js";
import type { AiChatAnswer } from "./chatService.js";

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const metrics: Array<[string, RegExp]> = [
  ["electricity-access", /pristup.{0,15}elektr|access to electricity/],
  ["internet-use", /pouziv.{0,15}internet|internet users|internet use/],
  ["life-expectancy", /delk.{0,15}zivot|life expectancy/],
  ["gdp", /\bhdp\b|\bgdp\b/],
  ["poverty", /chudob|poverty|socialni.{0,15}vylouc/],
  ["youth-unemployment", /nezamestnan.{0,15}mlad|youth unemployment/],
  ["unemployment", /nezamestnan|unemployment/],
  ["housing-cost", /naklad.{0,15}bydlen|housing cost/],
  ["population-density", /hustot.{0,15}obyvatel|population density/],
  ["population", /obyvatel|population/]
];
const aliases: Record<string, string[]> = {
  CZ: [
    "cr",
    "cesko",
    "cesku",
    "ceska republika",
    "ceske republice",
    "ceske republiky",
    "czechia",
    "czech republic"
  ],
  ES: ["spanelsko", "spanelsku", "spanelska", "spain"],
  DE: ["nemecko", "nemecku", "nemecka", "germany"],
  SK: ["slovensko", "slovensku", "slovenska", "slovakia"],
  PL: ["polsko", "polsku", "polska", "poland"],
  FR: ["francie", "francii", "france"],
  AT: ["rakousko", "rakousku", "austria"],
  IT: ["italie", "italii", "italy"],
  PT: ["portugalsko", "portugalsku", "portugal"]
};
const countries = Array.from({ length: 26 * 26 }, (_, i) =>
  String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26))
);
for (const code of countries)
  for (const lang of ["cs", "en"]) {
    const name = new Intl.DisplayNames([lang], { type: "region" }).of(code);
    if (name && name !== code) (aliases[code] ??= []).push(normalize(name));
  }
function countryIn(text: string) {
  const padded = ` ${normalize(text).replace(/[^a-z0-9 ]/g, " ")} `;
  return Object.entries(aliases).find(([, names]) =>
    names.some((name) => padded.includes(` ${name} `))
  )?.[0];
}
export interface StatisticalQuestion {
  themeId: string;
  country?: string;
  period?: string;
  lowest: boolean;
}
/** Recognize only supported measures. A named country overrides map position. A short follow-up
 * may inherit the last explicit country, but a new location never silently inherits it. */
export function parseStatisticalQuestion(
  message: string,
  history: readonly string[] = []
): StatisticalQuestion | null {
  const text = normalize(message);
  const last = history.at(-1);
  const previous = last ? parseStatisticalQuestion(last, history.slice(-24, -1)) : null;
  const continuation = /^(a |a co |co |a jak |what about |and )/.test(text);
  let themeId = metrics.find(([, re]) => re.test(text))?.[0];
  const country = countryIn(message);
  if (!themeId && country && continuation) themeId = previous?.themeId;
  if (!themeId || (!country && /\b(tu|tady|zde|here)\b/.test(text))) return null;
  const inheritCountry = continuation && !/\b(v|ve|in|na)\s+/.test(text);
  const period =
    text.match(/\b(20\d{2}|19\d{2})\b/)?.[1] ?? (continuation ? previous?.period : undefined);
  return {
    themeId,
    country: country ?? (inheritCountry ? previous?.country : undefined),
    period,
    lowest: /nejmens|nejniz|lowest|least/.test(text)
  };
}
export interface StatisticalData {
  countryName: string;
  bbox: [number, number, number, number];
  dataset?: StatDatasetDescriptor;
  period?: string;
  expected: number;
  rows: Array<{ code: string; name: string; value: number; flag?: string }>;
  regions?: Array<{
    code: string;
    name: string;
    value: number | null;
    geometry: unknown;
    boundarySource: string;
  }>;
}
export function formatStatisticalAnswer(
  question: StatisticalQuestion,
  data: StatisticalData
): AiChatAnswer {
  const descriptor = data.dataset;
  const rows = [...data.rows].sort((a, b) =>
    question.lowest ? a.value - b.value : b.value - a.value
  );
  const regional = descriptor?.geoLevel !== "country";
  const title = descriptor?.nameCs ?? descriptor?.name ?? question.themeId;
  const label = `${title} · ${data.countryName}`;
  const sourceId = descriptor ? `statistics:${descriptor.id}:${data.period}` : "";
  const format = (value: number) =>
    new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(value);
  const coverage = `${rows.length} z ${data.expected} území s hranicemi`;
  let text = `${data.countryName}: pro tento ukazatel${question.period ? ` v roce ${question.period}` : ""} zatím nemáme publikované hodnoty s odpovídajícími hranicemi. Žebříček proto nelze sestavit.`;
  if (rows.length && descriptor) {
    text =
      regional && rows.length > 1
        ? `Nej${question.lowest ? "nižší" : "vyšší"} hodnotu ukazatele „${title}“ má v dostupných datech ${rows[0]!.name}: ${format(rows[0]!.value)} ${descriptor.unit} (${data.period}). Srovnání pro ${data.countryName} zahrnuje ${coverage}, na úrovni ${descriptor.geoLevel.toUpperCase()}.`
        : `${data.countryName}: ${title} dosahuje ${format(rows[0]!.value)} ${descriptor.unit} (${data.period}). K dispozici je pouze ${regional ? "jedno území" : "celostátní hodnota"}; nelze z ní určit, kde uvnitř země je situace nejhorší.`;
    if (question.themeId === "poverty")
      text +=
        " Jde o ohrožení chudobou nebo sociálním vyloučením (AROPE), nikoli příjem domácností ani samostatnou míru příjmové chudoby.";
    if (regional) text += " Regiony NUTS 2 nejsou jednotlivé obce ani ve všech zemích kraje.";
    if (rows.some((r) => r.flag))
      text += " Některé hodnoty mají zdrojovou poznámku; je uvedena u řádku.";
  }
  let mapResult: MapResultDraft | undefined;
  if (descriptor && data.regions?.length && data.period) {
    const values = data.regions.flatMap((r) => (r.value === null ? [] : [r.value]));
    const minimum = Math.min(...values),
      maximum = Math.max(...values);
    const candidate = {
      schema: "mapos.map-result",
      schemaVersion: "1.0.0",
      id: `statistics-${descriptor.id}-${question.country}`,
      conversationId: "validation",
      runId: "validation",
      revision: 0,
      title: `${label} · ${data.period} · generalizované hranice`,
      sources: [
        { id: sourceId, label: descriptor.attribution, url: descriptor.documentationUrl },
        ...[...new Set(data.regions.map((r) => r.boundarySource))].map((id) => ({
          id: `boundary:${id}`,
          label: `Hranice · ${id}`
        }))
      ],
      style: {
        palette: minimum < 0 && maximum > 0 ? "diverging" : "blue",
        opacity: 0.7,
        minimum,
        maximum: maximum === minimum ? minimum + 1 : maximum,
        ...(minimum < 0 && maximum > 0 ? { midpoint: 0 } : {})
      },
      legend: {
        title,
        unit: descriptor.unit,
        time: data.period,
        noDataLabel: "Bez publikované hodnoty"
      },
      data: {
        type: "FeatureCollection",
        features: data.regions.map((r) => ({
          type: "Feature",
          id: r.code,
          geometry: r.geometry,
          properties: { title: r.name, sourceId, value: r.value }
        }))
      }
    };
    if (isMapResultArtifact(candidate)) mapResult = candidate;
  }
  return {
    ...(mapResult ? { mapResults: [mapResult] } : {}),
    execution: "deterministic",
    intent: "question",
    text,
    cards: [
      {
        type: "statistic",
        title: label,
        themeId: question.themeId,
        period: data.period ?? question.period ?? "latest",
        country: question.country!,
        geoLevel: descriptor?.geoLevel ?? "unknown",
        bbox: data.bbox,
        excludedDatasetIds: STAT_DATASETS.filter(
          (d) => d.themeId === question.themeId && d.id !== descriptor?.id
        ).map((d) => d.id),
        available: rows.length > 0
      },
      ...(rows.length && descriptor
        ? [
            {
              type: "facts" as const,
              title: `${data.period} · ${descriptor.geoLevel.toUpperCase()} · ${coverage}`,
              items: rows.slice(0, 50).map((row) => ({
                label: row.name,
                value: `${format(row.value)} ${descriptor.unit}`,
                sourceIds: [sourceId],
                note: `${data.period}${row.flag ? ` · poznámka Eurostat: ${row.flag}` : ""}`
              }))
            }
          ]
        : [])
    ],
    sources: descriptor
      ? [
          {
            sourceId,
            label: `${descriptor.attribution} · ${title} · ${data.period}`,
            url: descriptor.documentationUrl
          }
        ]
      : [],
    followUps: ["A nezaměstnanost?", "A chudoba?", "A ve Španělsku?"].filter(
      (q) => !normalize(q).includes(question.themeId === "poverty" ? "chudob" : "nezamestnan")
    )
  };
}
export async function readStatisticalData(
  question: StatisticalQuestion,
  signal?: AbortSignal
): Promise<StatisticalData | null> {
  signal?.throwIfAborted();
  // The country geometry and source territory codes define membership, not viewport overlap.
  return sql.begin(async (tx) => {
    await tx`SET LOCAL statement_timeout = '8000'`;
    const bounds = await tx`SELECT name,ST_XMin(Box3D(geom)) AS w,ST_YMin(Box3D(geom)) AS s,
      ST_XMax(Box3D(geom)) AS e,ST_YMax(Box3D(geom)) AS n FROM geo_units
      WHERE level='country' AND code=${question.country!} ORDER BY edition DESC LIMIT 1`;
    const country = bounds[0];
    if (!country) return null;
    const base: StatisticalData = {
      countryName:
        new Intl.DisplayNames(["cs"], { type: "region" }).of(question.country!) ??
        String(country.name),
      bbox: [Number(country.w), Number(country.s), Number(country.e), Number(country.n)],
      expected: 0,
      rows: []
    };
    const datasets = STAT_DATASETS.filter(
      (d) => d.themeId === question.themeId && ["nuts2", "country"].includes(d.geoLevel)
    ).sort((a, b) => Number(a.geoLevel === "country") - Number(b.geoLevel === "country"));
    for (const dataset of datasets) {
      signal?.throwIfAborted();
      const nutsPrefix =
        question.country === "GR" ? "EL" : question.country === "GB" ? "UK" : question.country!;
      const codes = dataset.geoLevel === "country" ? question.country! : `${nutsPrefix}%`;
      const periods = await tx`SELECT s.period,COUNT(DISTINCT s.geo_code)::integer AS count
        FROM stat_series s JOIN geo_units g ON g.level=s.geo_level AND g.code=s.geo_code
        AND (s.boundary_edition IS NULL OR s.boundary_edition=g.edition)
        WHERE s.dataset_id=${dataset.id} AND s.geo_code LIKE ${codes} AND s.value IS NOT NULL
        AND (${question.period ?? null}::text IS NULL OR s.period=${question.period ?? null})
        GROUP BY s.period ORDER BY s.period DESC LIMIT 1`;
      if (!periods[0]) continue;
      const period = String(periods[0].period);
      const values =
        await tx`SELECT DISTINCT ON(s.geo_code) s.geo_code AS code,g.name,s.value,s.flag FROM stat_series s
        JOIN geo_units g ON g.level=s.geo_level AND g.code=s.geo_code AND (s.boundary_edition IS NULL OR s.boundary_edition=g.edition)
        WHERE s.dataset_id=${dataset.id} AND s.geo_code LIKE ${codes} AND s.period=${period} AND s.value IS NOT NULL
        ORDER BY s.geo_code,g.edition DESC LIMIT 500`;
      const expected =
        await tx`SELECT COUNT(DISTINCT code)::integer AS count FROM geo_units WHERE level=${dataset.geoLevel} AND code LIKE ${codes}`;
      const regions = await tx`SELECT DISTINCT ON(g.code) g.code,g.name,g.source_id,s.value,
        ST_AsGeoJSON(ST_SimplifyPreserveTopology(g.geom,0.005),5)::json AS geometry
        FROM geo_units g LEFT JOIN stat_series s ON s.geo_level=g.level AND s.geo_code=g.code
        AND s.dataset_id=${dataset.id} AND s.period=${period}
        AND (s.boundary_edition IS NULL OR s.boundary_edition=g.edition)
        WHERE g.level=${dataset.geoLevel} AND g.code LIKE ${codes}
        ORDER BY g.code,(s.value IS NOT NULL) DESC,g.edition DESC LIMIT 500`;
      signal?.throwIfAborted();
      return {
        ...base,
        dataset,
        period,
        regions: regions.map((r) => ({
          code: String(r.code),
          name: String(r.name),
          value: r.value === null ? null : Number(r.value),
          geometry: r.geometry,
          boundarySource: String(r.source_id)
        })),
        expected: Number(expected[0]?.count ?? 0),
        rows: values.map((r) => ({
          code: String(r.code),
          name: String(r.name),
          value: Number(r.value),
          ...(r.flag ? { flag: String(r.flag) } : {})
        }))
      };
    }
    return base;
  });
}
export async function answerStatisticalQuestion(
  message: string,
  history: readonly string[],
  signal?: AbortSignal
): Promise<AiChatAnswer | null> {
  const question = parseStatisticalQuestion(message, history);
  if (!question) return null;
  const empty = (text: string): AiChatAnswer => ({
    execution: "deterministic",
    intent: "question",
    text,
    cards: [],
    sources: [],
    followUps: []
  });
  if (!question.country)
    return empty(
      "Pro kterou zemi chceš tento ukazatel porovnat? Napiš například „Kde je největší chudoba v ČR“. Aktuální výřez není automaticky oblastí tvé otázky."
    );
  try {
    const data = await readStatisticalData(question, signal);
    return data
      ? formatStatisticalAnswer(question, data)
      : empty(
          "Pro požadovanou zemi zatím nemáme připravené odpovídající hranice. Statistiku nelze spolehlivě vykreslit."
        );
  } catch (error) {
    signal?.throwIfAborted();
    return empty(
      "Statistická data se teď nepodařilo načíst. Zkus otázku zopakovat; chyba zdroje neznamená nulovou hodnotu ani nepřítomnost dat."
    );
  }
}
