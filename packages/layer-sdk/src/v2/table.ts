/**
 * Spreadsheets as map data (§20.3).
 *
 * The file a public authority publishes is a table, not a map: an XLSX exported from Excel in
 * Windows-1250, with a decimal comma, a semicolon delimiter, and a column of territory codes
 * that a reader recognises and no parser does. Every rule here exists because assuming the
 * opposite silently produced a wrong map rather than an error — UTF-8 that turns Č into a
 * replacement character, `1 234,5` read as 1, a coordinate pair in metres that plots off the
 * coast of Africa.
 *
 * Nothing here talks to a network or a database. Detection returns what it found and how sure
 * it is, and the caller decides; a heuristic that acts on its own guess is how an import ends
 * up joining postcodes onto region codes without saying so.
 */

import { unzipSync } from "fflate";
import { decodeXmlText, xmlAttribute, xmlElements } from "./xml.js";

export type TableFormat = "csv" | "xlsx";
export type TableEncoding = "utf-8" | "windows-1250";

export interface ParsedTable {
  rows: string[][];
  format: TableFormat;
  encoding: TableEncoding | null;
  /** Null for XLSX, where the question does not arise. */
  delimiter: "," | ";" | "\t" | null;
}

/** The `geo_units.level` a column of codes appears to be in. */
export type TerritoryLevel = "country" | "nuts1" | "nuts2" | "nuts3" | "lau";

export interface TerritoryColumn {
  index: number;
  header: string;
  level: TerritoryLevel;
  /** Rows whose value looked like a code of that level, out of the rows examined. */
  matched: number;
  total: number;
}

export interface TableObservation {
  geoCode: string;
  value: number | null;
}

export interface TableJoin {
  level: TerritoryLevel;
  codeColumn: number;
  valueColumn: number;
  observations: TableObservation[];
  /** Rows dropped, and why, so an import can say "84 of 91 rows joined". */
  skipped: number;
  warnings: string[];
}

const XLSX_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

export function looksLikeXlsx(bytes: Uint8Array): boolean {
  return XLSX_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * Text out of bytes, with the encoding named rather than assumed.
 *
 * UTF-8 is tried strictly first: a Windows-1250 file almost always contains a byte sequence
 * that is not valid UTF-8, so a strict decode failing is strong evidence, while a lenient one
 * would succeed on both and leave the accents mangled.
 */
export function decodeTableText(bytes: Uint8Array): { text: string; encoding: TableEncoding } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: decodeWindows1250(bytes), encoding: "windows-1250" };
  }
}

/** 0x80–0xFF of Windows-1250. `\uFFFD` marks the five byte values the codepage leaves undefined. */
const CP1250_HIGH =
  "€\uFFFD‚\uFFFD„…†‡\uFFFD‰Š‹ŚŤŽŹ" +
  "\uFFFD‘’“”•–—\uFFFD™š›śťžź" +
  "\u00a0ˇ˘Ł¤Ą¦§¨©Ş«¬\u00ad®Ż" +
  "°±˛ł´µ¶·¸ąş»Ľ˝ľż" +
  "ŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎ" +
  "ĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢß" +
  "ŕáâăäĺćçčéęëěíîď" +
  "đńňóôőö÷řůúűüýţ˙";

function decodeWindows1250(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    text += byte < 0x80 ? String.fromCharCode(byte) : CP1250_HIGH[byte - 0x80];
  }
  return text;
}

/**
 * Which delimiter the file uses, decided on the header line.
 *
 * Counting over the whole file would let a free-text column full of commas outvote the real
 * delimiter; the header is the one line that is guaranteed to be one field per column.
 */
export function detectDelimiter(text: string): "," | ";" | "\t" {
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  const counts: Array<[",", number] | [";", number] | ["\t", number]> = [
    [",", (header.match(/,/g) ?? []).length],
    [";", (header.match(/;/g) ?? []).length],
    ["\t", (header.match(/\t/g) ?? []).length]
  ];
  const best = counts.sort((a, b) => b[1] - a[1])[0]!;
  return best[1] > 0 ? best[0] : ",";
}

export function parseDelimitedRows(text: string, delimiter: "," | ";" | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index <= text.length; index += 1) {
    const character = text[index] ?? "\n";
    if (quoted && character === '"' && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (!quoted && character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((entry) => entry.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new TypeError("Tabulka má neuzavřené uvozovky.");
  return rows;
}

/**
 * The first worksheet of an XLSX, as rows of text.
 *
 * An XLSX is a zip of XML, and the only parts a table import needs are the shared string pool
 * and one sheet. Cells are placed by their `r` reference rather than by order, because a sheet
 * omits empty cells entirely — reading them in sequence shifts every value after a gap into the
 * wrong column, which is the failure that makes a joined map subtly wrong instead of empty.
 */
export function parseXlsxRows(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes);
  const decoder = new TextDecoder("utf-8");
  const sheetName = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()[0];
  if (!sheetName) throw new TypeError("Sešit neobsahuje žádný list.");

  const shared = files["xl/sharedStrings.xml"]
    ? xmlElements(decoder.decode(files["xl/sharedStrings.xml"]), "si").map((element) =>
        xmlElements(element.inner, "t")
          .map((part) => decodeXmlText(part.inner))
          .join("")
      )
    : [];

  const sheet = decoder.decode(files[sheetName]!);
  const rows: string[][] = [];
  for (const rowElement of xmlElements(sheet, "row")) {
    const row: string[] = [];
    for (const cell of xmlElements(rowElement.inner, "c")) {
      const reference = xmlAttribute(cell.attributes, "r");
      const column = reference ? columnIndex(reference) : row.length;
      const type = xmlAttribute(cell.attributes, "t");
      row[column] = cellText(cell.inner, type ?? null, shared);
    }
    for (let index = 0; index < row.length; index += 1) row[index] ??= "";
    if (row.some((entry) => entry.trim())) rows.push(row);
  }
  return rows;
}

function cellText(content: string, type: string | null, shared: readonly string[]): string {
  if (type === "inlineStr") {
    return xmlElements(content, "t")
      .map((part) => decodeXmlText(part.inner))
      .join("");
  }
  const raw = xmlElements(content, "v")[0]?.inner ?? "";
  const value = decodeXmlText(raw);
  if (type !== "s") return value;
  const index = Number(value);
  return Number.isInteger(index) ? (shared[index] ?? "") : value;
}

/** `BC12` → 54. Spreadsheet columns are base-26 with no zero digit. */
export function columnIndex(reference: string): number {
  const letters = /^([A-Z]+)/.exec(reference.toUpperCase())?.[1] ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

export function parseTable(bytes: Uint8Array, filename = ""): ParsedTable {
  // Sniffed before the name is trusted: a file saved from a browser is as likely to be called
  // `download` as `data.xlsx`.
  if (looksLikeXlsx(bytes) || /\.xlsx$/i.test(filename)) {
    return { rows: parseXlsxRows(bytes), format: "xlsx", encoding: null, delimiter: null };
  }
  const { text, encoding } = decodeTableText(bytes);
  const delimiter = detectDelimiter(text);
  return { rows: parseDelimitedRows(text, delimiter), format: "csv", encoding, delimiter };
}

/**
 * A number out of a spreadsheet cell.
 *
 * Handles the Czech conventions an export carries: a comma for the decimal point, and spaces —
 * including the non-breaking kind Excel writes — as thousands separators. A cell holding a
 * statistical office's "no data" marker returns null rather than zero, because a zero drawn on
 * a choropleth is a claim and an absence is not.
 */
export function parseTableNumber(value: string | undefined): number | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed || isNoDataMarker(trimmed)) return null;
  const normalised = trimmed
    .replace(/[\s\u00a0\u202f']/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^0-9.eE+-]/g, "");
  if (!normalised || !/\d/.test(normalised)) return null;
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The tokens statistical offices write where a number would go. Eurostat uses a bare colon. */
export function isNoDataMarker(value: string): boolean {
  return /^(n\/a|na|nd|:|-|—|\.\.|x|\.)$/i.test(value.trim());
}

const LEVEL_PATTERNS: Array<[TerritoryLevel, RegExp]> = [
  ["country", /^[A-Z]{2}$/],
  ["nuts1", /^[A-Z]{2}[0-9A-Z]$/],
  ["nuts2", /^[A-Z]{2}[0-9A-Z]{2}$/],
  ["nuts3", /^[A-Z]{2}[0-9A-Z]{3}$/],
  // GISCO's LAU key, and the bare six-digit municipality number a Czech export uses.
  ["lau", /^([A-Z]{2}_[0-9A-Z]+|\d{6})$/]
];

/**
 * The column holding territory codes, and which level they are.
 *
 * Every column is scored against every level and the best-supported pair wins, rather than
 * trusting a header called "kód": exports label that column `NUTS3`, `Kód území`, `geo`, `LAU`
 * or nothing at all, while the shape of the values is the same everywhere.
 */
export function detectTerritoryColumn(rows: readonly string[][]): TerritoryColumn | null {
  const [header = [], ...body] = rows;
  if (!body.length) return null;
  const sample = body.slice(0, 200);
  let best: TerritoryColumn | null = null;

  for (let column = 0; column < header.length; column += 1) {
    const values = sample
      .map((row) => (row[column] ?? "").trim())
      .filter((value) => value.length > 0);
    if (!values.length) continue;
    for (const [level, pattern] of LEVEL_PATTERNS) {
      const matched = values.filter((value) => pattern.test(value.toUpperCase())).length;
      // Two thirds, not all: a table with a "EU27" or "Celkem" summary row is still a table of
      // regions, and refusing it because of the total line helps nobody.
      if (matched / values.length < 0.66) continue;
      const candidate: TerritoryColumn = {
        index: column,
        header: (header[column] ?? "").trim(),
        level,
        matched,
        total: values.length
      };
      // A five-character code also matches nothing else, but a two-letter one matches the
      // country pattern as well, so the finest level with full support wins.
      if (!best || candidate.matched > best.matched || levelRank(level) > levelRank(best.level)) {
        if (!best || candidate.matched >= best.matched) best = candidate;
      }
    }
  }
  return best;
}

function levelRank(level: TerritoryLevel): number {
  return ["country", "nuts1", "nuts2", "nuts3", "lau"].indexOf(level);
}

/** Columns that parse as numbers often enough to be a measure rather than a label. */
export function detectValueColumns(rows: readonly string[][], exclude: number): number[] {
  const [header = [], ...body] = rows;
  const sample = body.slice(0, 200);
  const columns: number[] = [];
  for (let column = 0; column < header.length; column += 1) {
    if (column === exclude) continue;
    const values = sample.map((row) => row[column]).filter((value) => (value ?? "").trim());
    if (!values.length) continue;
    const numeric = values.filter((value) => parseTableNumber(value) !== null).length;
    // A gap counts towards the column being a measure rather than against it: a series with a
    // quarter of its territories unmeasured is the normal case, and rejecting it would leave the
    // import looking for a number column that does not exist.
    const readable = values.filter(
      (value) => parseTableNumber(value) !== null || isNoDataMarker(value ?? "")
    ).length;
    if (numeric > 0 && readable / values.length >= 0.8) columns.push(column);
  }
  return columns;
}

/**
 * Rows to observations, joined on the territory code.
 *
 * Duplicate codes keep the first row and warn. Summing them would be wrong for a rate and right
 * for a count, and the table does not say which it is.
 */
export function joinTable(
  rows: readonly string[][],
  options: { codeColumn?: number; valueColumn?: number; level?: TerritoryLevel } = {}
): TableJoin {
  const detected = detectTerritoryColumn(rows);
  const codeColumn = options.codeColumn ?? detected?.index;
  if (codeColumn === undefined) {
    throw new TypeError("V tabulce jsme nenašli sloupec s kódem území.");
  }
  const level = options.level ?? detected?.level ?? "nuts3";
  const valueColumn = options.valueColumn ?? detectValueColumns(rows, codeColumn)[0];
  if (valueColumn === undefined) throw new TypeError("V tabulce jsme nenašli číselný sloupec.");

  const warnings: string[] = [];
  const seen = new Set<string>();
  const observations: TableObservation[] = [];
  let skipped = 0;
  let duplicates = 0;

  for (const row of rows.slice(1)) {
    const geoCode = (row[codeColumn] ?? "").trim().toUpperCase();
    if (!geoCode) {
      skipped += 1;
      continue;
    }
    if (seen.has(geoCode)) {
      duplicates += 1;
      continue;
    }
    seen.add(geoCode);
    observations.push({ geoCode, value: parseTableNumber(row[valueColumn]) });
  }

  if (duplicates) warnings.push(`${duplicates} řádků mělo kód, který se v tabulce opakuje.`);
  const empty = observations.filter((entry) => entry.value === null).length;
  if (empty) warnings.push(`${empty} území nemá v tabulce hodnotu.`);
  return { level, codeColumn, valueColumn, observations, skipped, warnings };
}

/* -------------------------------------------------------------------------------------------
 * S-JTSK
 * ---------------------------------------------------------------------------------------- */

/**
 * S-JTSK (Křovák, EPSG:5514) covers Czechia and Slovakia, and its coordinates are negative
 * metres — Y roughly −900 000 to −400 000 west-east, X roughly −1 230 000 to −930 000
 * south-north. Nothing else a table is likely to hold lands in that box, so the range is a
 * reliable test where a column header ("X", "Y", "SOUR_X") is not.
 */
export function looksLikeSjtsk(first: number, second: number): boolean {
  const inY = (value: number) => value <= -400_000 && value >= -910_000;
  const inX = (value: number) => value <= -930_000 && value >= -1_240_000;
  return (inY(first) && inX(second)) || (inY(second) && inX(first));
}

/**
 * Křovák inverse, then Bessel to WGS-84.
 *
 * The projection formulas are EPSG's (method 9819); the datum step is the standard Czech
 * seven-parameter key. Together they land within a metre or two of the official transformation,
 * which is far tighter than the precision of a table that gives a municipality one point.
 *
 * The two numbers are sorted rather than named, because half the exports label them X and Y and
 * the other half label them the other way round. The projection's ranges do not overlap, so the
 * pair identifies itself.
 */
export function sjtskToWgs84(first: number, second: number): { lng: number; lat: number } {
  const [westing, southing] =
    Math.abs(first) < Math.abs(second)
      ? [Math.abs(first), Math.abs(second)]
      : [Math.abs(second), Math.abs(first)];

  const a = 6377397.155;
  const e = 0.081696831215303;
  const latC = (49.5 * Math.PI) / 180;
  // Written as degrees, minutes and seconds — 24°50′ east of Ferro and an azimuth of
  // 30°17′17.3031″ — because that is how the projection is defined and how it can be checked.
  const lonO = ((24 + 50 / 60) * Math.PI) / 180;
  const alphaC = ((30 + 17 / 60 + 17.30311 / 3600) * Math.PI) / 180;
  const latP = (78.5 * Math.PI) / 180;
  const kP = 0.9999;

  const A = (a * Math.sqrt(1 - e * e)) / (1 - e * e * Math.sin(latC) ** 2);
  const B = Math.sqrt(1 + (e * e * Math.cos(latC) ** 4) / (1 - e * e));
  const gamma0 = Math.asin(Math.sin(latC) / B);
  const t0 =
    (Math.tan(Math.PI / 4 + gamma0 / 2) *
      ((1 + e * Math.sin(latC)) / (1 - e * Math.sin(latC))) ** ((e * B) / 2)) /
    Math.tan(Math.PI / 4 + latC / 2) ** B;
  const n = Math.sin(latP);
  const r0 = (kP * A) / Math.tan(latP);

  const r = Math.hypot(southing, westing);
  const theta = Math.atan2(westing, southing);
  const D = theta / n;
  const T = 2 * (Math.atan((r0 / r) ** (1 / n) * Math.tan(Math.PI / 4 + latP / 2)) - Math.PI / 4);
  const U = Math.asin(
    Math.cos(alphaC) * Math.sin(T) - Math.sin(alphaC) * Math.cos(T) * Math.cos(D)
  );
  const V = Math.asin((Math.cos(T) * Math.sin(D)) / Math.cos(U));
  const lonBessel = lonO - V / B;

  // No closed form: the conformal latitude is inverted by iteration, which converges in three
  // rounds at this eccentricity.
  let latBessel = U;
  for (let round = 0; round < 12; round += 1) {
    const next =
      2 *
      (Math.atan(
        t0 ** (-1 / B) *
          Math.tan(U / 2 + Math.PI / 4) ** (1 / B) *
          ((1 + e * Math.sin(latBessel)) / (1 - e * Math.sin(latBessel))) ** (e / 2)
      ) -
        Math.PI / 4);
    if (Math.abs(next - latBessel) < 1e-13) {
      latBessel = next;
      break;
    }
    latBessel = next;
  }

  return besselToWgs84(latBessel, lonBessel);
}

/** Geocentric seven-parameter shift, Bessel 1841 → WGS-84, with the Czech national key. */
function besselToWgs84(lat: number, lng: number): { lng: number; lat: number } {
  const a = 6377397.155;
  const e2 = 0.006674372230614;
  const sinLat = Math.sin(lat);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const x = N * Math.cos(lat) * Math.cos(lng);
  const y = N * Math.cos(lat) * Math.sin(lng);
  const z = N * (1 - e2) * sinLat;

  const arcsec = Math.PI / (180 * 3600);
  const wx = 4.99821 * arcsec;
  const wy = 1.58676 * arcsec;
  const wz = 5.2611 * arcsec;
  const m = 3.543e-6;
  const xn = 570.69 + (1 + m) * (x + wz * y - wy * z);
  const yn = 85.69 + (1 + m) * (-wz * x + y + wx * z);
  const zn = 462.84 + (1 + m) * (wy * x - wx * y + z);

  const aw = 6378137;
  const ew2 = 0.00669437999014;
  const p = Math.hypot(xn, yn);
  let latWgs = Math.atan2(zn, p * (1 - ew2));
  for (let round = 0; round < 8; round += 1) {
    const sin = Math.sin(latWgs);
    const Nw = aw / Math.sqrt(1 - ew2 * sin * sin);
    const height = p / Math.cos(latWgs) - Nw;
    latWgs = Math.atan2(zn, p * (1 - (ew2 * Nw) / (Nw + height)));
  }
  return { lng: (Math.atan2(yn, xn) * 180) / Math.PI, lat: (latWgs * 180) / Math.PI };
}
