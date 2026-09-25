import { createHash } from "node:crypto";
import type { AiCitation } from "./contracts.js";
import type { AiPlaceSearchRecord } from "./placeSearch.js";

/**
 * Places an answer talks about, turned into pins the server can vouch for.
 *
 * Models differ in how disciplined they are with tools: one geocodes every place and submits ids,
 * another lists places in its prose, a third writes a JSON block instead of calling a tool. The
 * map should not depend on which model answered. So every answer is read the same way — an
 * explicit `places` list, a JSON block, coordinates, a list of named places — and every name goes
 * through the geocoder before it becomes a pin. Coordinates the model wrote itself are accepted
 * only when the geocoder has nothing better, and they are cited as unverified.
 */

export interface MentionedPlace {
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  note?: string;
}

export const MAX_MENTIONED_PLACES = 20;

/** The shape a model is asked to use for `places` in `submit_answer` and `submit_plan`. */
export const MENTIONED_PLACES_SCHEMA = {
  type: "array",
  maxItems: MAX_MENTIONED_PLACES,
  description:
    "Místa z odpovědi, která mají být na mapě: název a úplná adresa, případně GPS. Server je sám geokóduje.",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 2, maxLength: 120 },
      address: { type: "string", maxLength: 240 },
      latitude: { type: "number", minimum: -90, maximum: 90 },
      longitude: { type: "number", minimum: -180, maximum: 180 },
      note: { type: "string", maxLength: 240 }
    }
  }
} as const;

export const MODEL_COORDINATES_SOURCE: AiCitation = {
  sourceId: "ai-model-coordinates",
  label: "Souřadnice uvedené v odpovědi AI; geokodér je nepotvrdil"
};

/** A geocoded candidate further than this from coordinates the model gave is a namesake. */
const SAME_PLACE_KM = 30;

function clean(value: string, max: number): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    out += code <= 31 || code === 127 ? " " : value[index];
  }
  return out
    .replace(/\*\*|__|`/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

function coordinate(value: unknown, limit: number): number | undefined {
  const number = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  return typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= limit
    ? number
    : undefined;
}

function mention(raw: unknown): MentionedPlace | null {
  if (typeof raw === "string") {
    const name = clean(raw, 120);
    return name.length >= 2 ? { name } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const rawName = entry.name ?? entry.title ?? entry.placeName ?? entry.place;
  const name = typeof rawName === "string" ? clean(rawName, 120) : "";
  const address = typeof entry.address === "string" ? clean(entry.address, 240) : "";
  const latitude = coordinate(entry.latitude ?? entry.lat, 90);
  const longitude = coordinate(entry.longitude ?? entry.lon ?? entry.lng, 180);
  const note = typeof entry.note === "string" ? clean(entry.note, 240) : "";
  const label = name || address;
  if (label.length < 2) return null;
  return {
    name: label,
    ...(address && address !== label ? { address } : {}),
    ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
    ...(note ? { note } : {})
  };
}

/** A `places` list as a model submitted it: tolerant of field names, strict about values. */
export function normaliseMentionedPlaces(raw: unknown): MentionedPlace[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { places?: unknown }).places)
      ? (raw as { places: unknown[] }).places
      : [];
  return dedupe(rows.map(mention).filter((entry): entry is MentionedPlace => Boolean(entry)));
}

function dedupe(mentions: MentionedPlace[]): MentionedPlace[] {
  const seen = new Set<string>();
  const out: MentionedPlace[] = [];
  for (const entry of mentions) {
    const key = fold(`${entry.name}|${entry.address ?? ""}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= MAX_MENTIONED_PLACES) break;
  }
  return out;
}

export function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
}

const JSON_FENCE = /```(?:json)?\s*([\s\S]*?)```/giu;
const COORDINATES =
  /(-?\d{1,2}(?:[.,]\d{3,}))\s*°?\s*([NS])?\s*[,;/ ]\s*(-?\d{1,3}(?:[.,]\d{3,}))\s*°?\s*([EWVZ])?/iu;
const LIST_ITEM = /^\s*(?:[-*•–]|\d{1,2}[.)])\s+(.+)$/u;

export interface ParsedAnswerText {
  /** The prose with any machine-readable block removed. */
  text: string;
  mentions: MentionedPlace[];
  /** A JSON object the model meant as a tool call, e.g. `{"name":"submit_answer","arguments":…}`. */
  toolCall?: { name: string; arguments: Record<string, unknown> };
}

function parseJson(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

function toolCallFrom(value: unknown): ParsedAnswerText["toolCall"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  const name = typeof entry.name === "string" ? entry.name : undefined;
  const args = entry.arguments ?? entry.parameters ?? entry.input;
  const parsed = typeof args === "string" ? parseJson(args) : args;
  if (!name || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  return { name, arguments: parsed as Record<string, unknown> };
}

/**
 * Reads places out of an answer written as text. A fenced JSON block wins (it is what the prompt
 * asks for when a tool call fails); otherwise lines with coordinates and list items that look like
 * names. Nothing here is trusted yet — every mention still goes through `resolveMentionedPlaces`.
 */
export function parseAnswerText(raw: string): ParsedAnswerText {
  let text = raw;
  const fromJson: MentionedPlace[] = [];
  let toolCall: ParsedAnswerText["toolCall"];

  const blocks = [...raw.matchAll(JSON_FENCE)];
  const bare = raw.trim();
  const candidates = blocks.length
    ? blocks.map((match) => ({ whole: match[0], body: match[1] ?? "" }))
    : /^[[{][\s\S]*[\]}]$/u.test(bare)
      ? [{ whole: raw, body: bare }]
      : [];
  for (const candidate of candidates) {
    const value = parseJson(candidate.body.trim());
    if (value === undefined) continue;
    text = text.replace(candidate.whole, " ");
    const call = toolCallFrom(value);
    if (call) {
      toolCall ??= call;
      fromJson.push(...normaliseMentionedPlaces(call.arguments.places));
      continue;
    }
    fromJson.push(...normaliseMentionedPlaces(value));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const prose = (value as { text?: unknown; answer?: unknown }).text;
      if (typeof prose === "string" && !text.trim()) text = prose;
    }
  }

  const fromLines: MentionedPlace[] = [];
  if (!fromJson.length) {
    for (const line of text.split(/\r?\n/u)) {
      const item = line.match(LIST_ITEM)?.[1];
      const gps = (item ?? line).match(COORDINATES);
      if (gps) {
        let latitude = coordinate(gps[1], 90);
        let longitude = coordinate(gps[3], 180);
        if (latitude !== undefined && gps[2]?.toUpperCase() === "S") latitude = -latitude;
        if (longitude !== undefined && /[WZ]/iu.test(gps[4] ?? "")) longitude = -longitude;
        const label = nameFromLine((item ?? line).slice(0, gps.index ?? undefined));
        if (latitude !== undefined && longitude !== undefined)
          fromLines.push({ name: label || `${latitude}, ${longitude}`, latitude, longitude });
        continue;
      }
      if (!item) continue;
      const parsed = listItemPlace(item);
      if (parsed) fromLines.push(parsed);
    }
  }

  return {
    text: text.replace(/\n{3,}/gu, "\n\n").trim(),
    mentions: dedupe([...fromJson, ...fromLines]),
    ...(toolCall ? { toolCall } : {})
  };
}

function nameFromLine(line: string): string {
  const bold = line.match(/\*\*([^*]{2,120})\*\*/u)?.[1];
  const raw = bold ?? line;
  return clean(
    raw
      .replace(LIST_ITEM, "$1")
      .replace(/(?:GPS|souřadnice|coordinates|poloha)\s*[:=]?\s*$/iu, "")
      .replace(/[\s:–—(,-]+$/u, ""),
    120
  );
}

/** "**Name** – Street 12, City – why" → name + address. Sentences are not places. */
function listItemPlace(item: string): MentionedPlace | null {
  const bold = item.match(/\*\*([^*]{2,120})\*\*/u)?.[1];
  const parts = clean(item, 400)
    .split(/\s[–—-]\s|:\s/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const name = clean(bold ?? parts[0] ?? "", 120);
  if (!looksLikeName(name)) return null;
  const address = parts
    .slice(bold ? 0 : 1)
    .map((part) => part.replace(/\*\*[^*]+\*\*/u, "").trim())
    .find((part) => /\d/u.test(part) && /,/u.test(part) && part.length <= 240);
  return { name, ...(address ? { address } : {}) };
}

function looksLikeName(value: string): boolean {
  if (value.length < 2 || value.length > 80) return false;
  const words = value.split(/\s+/u);
  if (words.length > 8) return false;
  // A place name starts with a capital; a sentence in a list ("vezměte si vodu") does not, and a
  // line ending in a full stop is prose.
  return /^\p{Lu}/u.test(value) && !/[.!?]$/u.test(value);
}

export type PlaceGeocoder = (query: string) => Promise<AiPlaceSearchRecord[]>;

export interface ResolvedMentions {
  places: AiPlaceSearchRecord[];
  sources: AiCitation[];
}

function distanceKm(a: { latitude: number; longitude: number }, b: typeof a): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

/** A geocoder answer for "Vrchlabí" that comes back as "Praha" is not the place that was meant. */
function namesMatch(query: string, title: string): boolean {
  const target = fold(title);
  const words = fold(query)
    .split(/[\s,.;:()/-]+/u)
    .filter((word) => word.length >= 4 || /^\d+$/u.test(word));
  if (!words.length) return target.includes(fold(query));
  return words.some((word) => target.includes(word));
}

function modelPoint(entry: MentionedPlace): AiPlaceSearchRecord {
  const { latitude, longitude } = entry as Required<Pick<MentionedPlace, "latitude" | "longitude">>;
  return {
    id: `ai-point:${createHash("sha256")
      .update(JSON.stringify([entry.name, longitude, latitude]))
      .digest("hex")
      .slice(0, 24)}`,
    layerId: "osm-poi",
    title: entry.name,
    category: "ai-mentioned-place",
    longitude,
    latitude,
    sourceId: MODEL_COORDINATES_SOURCE.sourceId
  };
}

/**
 * Every mention becomes a pin only through the geocoder, except coordinates the model gave for a
 * place the geocoder cannot find — those are kept and cited as unverified rather than dropped,
 * because an answer that names a spot the user can then check is better than no pin at all.
 */
export async function resolveMentionedPlaces(
  mentions: readonly MentionedPlace[],
  geocode: PlaceGeocoder,
  options: { concurrency?: number } = {}
): Promise<ResolvedMentions> {
  const queue = mentions.slice(0, MAX_MENTIONED_PLACES);
  const resolved: (AiPlaceSearchRecord | null)[] = new Array(queue.length).fill(null);
  let usedModelCoordinates = false;
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const index = next++;
      const entry = queue[index]!;
      const hasPoint = entry.latitude !== undefined && entry.longitude !== undefined;
      const query = entry.address
        ? fold(entry.address).includes(fold(entry.name))
          ? entry.address
          : `${entry.name}, ${entry.address}`
        : entry.name;
      const candidates = await geocode(query).catch((): AiPlaceSearchRecord[] => []);
      const plausible = candidates.filter(
        (candidate) =>
          (entry.address ? true : namesMatch(entry.name, candidate.title)) &&
          (!hasPoint ||
            distanceKm(candidate, entry as { latitude: number; longitude: number }) <=
              SAME_PLACE_KM)
      );
      const chosen = plausible[0];
      if (chosen) {
        resolved[index] = { ...chosen, title: entry.name.length >= 2 ? entry.name : chosen.title };
      } else if (hasPoint) {
        resolved[index] = modelPoint(entry);
        usedModelCoordinates = true;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, queue.length)) }, worker)
  );
  const seen = new Set<string>();
  const places = resolved.filter((place): place is AiPlaceSearchRecord => {
    if (!place || seen.has(place.id)) return false;
    seen.add(place.id);
    return true;
  });
  return { places, sources: usedModelCoordinates ? [MODEL_COORDINATES_SOURCE] : [] };
}
