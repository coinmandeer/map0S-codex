import { containsControlCharacters } from "./textSafety.js";

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface ParsedCoordinates extends Coordinates {
  format: "decimal" | "dms";
  normalized: string;
}

interface CoordinateToken {
  value: number;
  hemisphere?: "N" | "S" | "E" | "W";
}

const SEPARATOR = /^[\s,;/]*$/;
const DECIMAL_TOKEN = /(?:([NSEW])\s*)?([+-]?\d{1,3}(?:[.,]\d+)?)(?:\s*°)?(?:\s*([NSEW]))?/gi;
const DMS_TOKEN =
  /(?:([NSEW])\s*)?([+-]?\d{1,3}(?:[.,]\d+)?)\s*°\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*')?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*")?\s*([NSEW])?/gi;

function canonicalNumber(value: number): string {
  const rounded = Number(value.toFixed(7));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function result(lat: number, lng: number, format: ParsedCoordinates["format"]): ParsedCoordinates {
  const safeLat = Object.is(lat, -0) ? 0 : lat;
  const safeLng = Object.is(lng, -0) ? 0 : lng;
  return {
    lat: safeLat,
    lng: safeLng,
    format,
    normalized: `${canonicalNumber(safeLat)}, ${canonicalNumber(safeLng)}`
  };
}

export function isValidCoordinates(value: Coordinates): boolean {
  return (
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    value.lat >= -90 &&
    value.lat <= 90 &&
    value.lng >= -180 &&
    value.lng <= 180
  );
}

function normalizeHemisphere(
  prefix?: string,
  suffix?: string
): CoordinateToken["hemisphere"] | null {
  if (prefix && suffix && prefix.toUpperCase() !== suffix.toUpperCase()) return null;
  const value = (suffix ?? prefix)?.toUpperCase();
  if (!value) return undefined;
  return value as CoordinateToken["hemisphere"];
}

function applyHemisphere(value: number, hemisphere: CoordinateToken["hemisphere"]): number | null {
  if (!hemisphere) return value;
  if (value < 0) return null;
  return hemisphere === "S" || hemisphere === "W" ? -value : value;
}

function coordinateAxis(hemisphere: CoordinateToken["hemisphere"]): "lat" | "lng" | undefined {
  if (hemisphere === "N" || hemisphere === "S") return "lat";
  if (hemisphere === "E" || hemisphere === "W") return "lng";
  return undefined;
}

function assignAxes(first: CoordinateToken, second: CoordinateToken): Coordinates | null {
  const firstAxis = coordinateAxis(first.hemisphere);
  const secondAxis = coordinateAxis(second.hemisphere);

  if (firstAxis && secondAxis && firstAxis === secondAxis) return null;

  let lat: number;
  let lng: number;
  if (firstAxis === "lat" || secondAxis === "lng") {
    lat = first.value;
    lng = second.value;
  } else if (firstAxis === "lng" || secondAxis === "lat") {
    lat = second.value;
    lng = first.value;
  } else if (Math.abs(first.value) > 90 && Math.abs(second.value) <= 90) {
    lat = second.value;
    lng = first.value;
  } else {
    lat = first.value;
    lng = second.value;
  }

  return isValidCoordinates({ lat, lng }) ? { lat, lng } : null;
}

function matchAllWithSafeGaps(input: string, pattern: RegExp): RegExpExecArray[] | null {
  pattern.lastIndex = 0;
  const matches: RegExpExecArray[] = [];
  let previousEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    if (!SEPARATOR.test(input.slice(previousEnd, match.index))) return null;
    matches.push(match);
    previousEnd = match.index + match[0].length;
  }

  if (!SEPARATOR.test(input.slice(previousEnd))) return null;
  return matches;
}

function parseDmsCandidate(input: string): ParsedCoordinates | null {
  const matches = matchAllWithSafeGaps(input, DMS_TOKEN);
  if (!matches || matches.length !== 2) return null;

  const tokens: CoordinateToken[] = [];
  for (const match of matches) {
    const hemisphere = normalizeHemisphere(match[1], match[5]);
    if (hemisphere === null) return null;
    const degrees = Number(match[2]!.replace(",", "."));
    const minutes = match[3] === undefined ? 0 : Number(match[3].replace(",", "."));
    const seconds = match[4] === undefined ? 0 : Number(match[4].replace(",", "."));
    if (
      !Number.isFinite(degrees) ||
      !Number.isFinite(minutes) ||
      !Number.isFinite(seconds) ||
      minutes < 0 ||
      minutes >= 60 ||
      seconds < 0 ||
      seconds >= 60
    ) {
      return null;
    }

    const absolute = Math.abs(degrees) + minutes / 60 + seconds / 3600;
    const signed = degrees < 0 ? -absolute : absolute;
    const value = applyHemisphere(signed, hemisphere);
    if (value === null) return null;
    tokens.push({ value, hemisphere });
  }

  const assigned = assignAxes(tokens[0]!, tokens[1]!);
  return assigned ? result(assigned.lat, assigned.lng, "dms") : null;
}

function parseDms(input: string): ParsedCoordinates | null {
  if (!/[°º˚]/.test(input)) return null;
  const normalizedSymbols = input
    .replace(/[º˚]/g, "°")
    .replace(/[′’‘´`]/g, "'")
    .replace(/[″“”]/g, '"');
  const direct = parseDmsCandidate(normalizedSymbols);
  if (direct) return direct;

  // Prefix notation (`N 49°… E 13°…`) is normalized only as a fallback so a suffix marker
  // between two components can never be mistaken for the prefix of the next one.
  const prefixNotation = normalizedSymbols.replace(
    /([NSEW])\s*([+-]?\d{1,3}(?:[.,]\d+)?\s*°(?:\s*\d{1,2}(?:[.,]\d+)?\s*')?(?:\s*\d{1,2}(?:[.,]\d+)?\s*")?)/gi,
    "$2$1"
  );
  return prefixNotation === normalizedSymbols ? null : parseDmsCandidate(prefixNotation);
}

function parseDecimalCandidate(input: string): ParsedCoordinates | null {
  const matches = matchAllWithSafeGaps(input, DECIMAL_TOKEN);
  if (!matches || matches.length !== 2) return null;

  const tokens: CoordinateToken[] = [];
  for (const match of matches) {
    const hemisphere = normalizeHemisphere(match[1], match[3]);
    if (hemisphere === null) return null;
    const raw = Number(match[2]!.replace(",", "."));
    if (!Number.isFinite(raw)) return null;
    const value = applyHemisphere(raw, hemisphere);
    if (value === null) return null;
    tokens.push({ value, hemisphere });
  }

  const assigned = assignAxes(tokens[0]!, tokens[1]!);
  return assigned ? result(assigned.lat, assigned.lng, "decimal") : null;
}

function parseDecimal(input: string): ParsedCoordinates | null {
  const direct = parseDecimalCandidate(input);
  if (direct) return direct;
  const prefixNotation = input.replace(/([NSEW])\s*([+-]?\d{1,3}(?:[.,]\d+)?(?:\s*°)?)/gi, "$2$1");
  return prefixNotation === input ? null : parseDecimalCandidate(prefixNotation);
}

/**
 * Parses coordinate text without guessing from unrelated prose. Decimal latitude/longitude,
 * decimal comma and DMS notation are accepted. A longitude-first pair is only swapped when
 * the first value cannot be a latitude, or when hemisphere markers make the axes explicit.
 */
export function parseCoordinates(input: string): ParsedCoordinates | null {
  if (typeof input !== "string" || input.length > 256 || containsControlCharacters(input))
    return null;
  const trimmed = input.trim().replace(/[−–—]/g, "-");
  if (!trimmed) return null;
  return parseDms(trimmed) ?? parseDecimal(trimmed);
}
