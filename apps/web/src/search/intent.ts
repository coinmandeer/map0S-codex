import { parseCoordinates, type ParsedCoordinates } from "./coordinates.js";
import {
  parseMapShareUrl,
  type MapShareUrlOptions,
  type ParsedMapShareLocation
} from "./shareUrl.js";
import { containsControlCharacters } from "./textSafety.js";

export type LocationIntent =
  | { kind: "empty" }
  | { kind: "coordinates"; input: string; coordinates: ParsedCoordinates }
  | { kind: "map-share"; input: string; location: ParsedMapShareLocation }
  | { kind: "category"; input: string; query: string; tag: string }
  | { kind: "address" | "locality" | "poi" | "place" | "ai"; input: string; query: string }
  | {
      kind: "invalid";
      input: string;
      reason: "unsupported-url" | "too-long" | "invalid-text";
    };

const URL_SHAPE = /^(?:https?:\/\/|www\.)/i;
const ADDRESS =
  /(?:\d{3}\s?\d{2}(?!\d)|(?<!\p{L})(?:ul(?:ice)?|nám(?:ěstí)?|tř(?:ída)?|street|road|avenue|square)(?!\p{L})|\p{L}[\p{L}.'-]*\s+\d+[a-z]?(?:\s*\/\s*\d+)?)/iu;
const LOCALITY_PREFIX = /^(?:město|obec|vesnice|okres|kraj|region|city|town|village)\s*:?\s+/iu;
const POI =
  /(?<!\p{L})(?:hrad|zámek|rozhledna|restaurace|bistro|kavárna|café|hotel|muzeum|galerie|nádraží|letiště|nemocnice|lékárna|parkoviště|čerpací stanice|camp|kemp|castle|restaurant|hotel|museum|station|airport|hospital|pharmacy)(?!\p{L})/iu;
const AI_COMMAND = /^(?:ai|asistent)\s*:\s*/iu;
const AI_ACTION = /(?:naplánuj|doporuč|navrhni|najdi mi|porovnej|plan|recommend|suggest|compare)/iu;
const AI_CONSTRAINT =
  /(?:bez|vhodn\p{L}*|otevřen\p{L}*|po cestě|s výhledem|s dětmi|do \d+|nejlevnější|nejrychlejší|accessible|open now|on the way|under \d+)/iu;

function normalizedText(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

/** Classifies input using a fixed cheap-to-expensive order. It performs no network request. */
export function resolveLocationIntent(
  input: string,
  options: MapShareUrlOptions = {}
): LocationIntent {
  if (containsControlCharacters(input)) return { kind: "invalid", input, reason: "invalid-text" };
  const query = normalizedText(input);
  if (!query) return { kind: "empty" };
  if (query.length > 512) return { kind: "invalid", input, reason: "too-long" };

  const coordinates = parseCoordinates(query);
  if (coordinates) return { kind: "coordinates", input, coordinates };

  const shared = parseMapShareUrl(query, options);
  if (shared) return { kind: "map-share", input, location: shared };
  if (URL_SHAPE.test(query)) return { kind: "invalid", input, reason: "unsupported-url" };

  if (/^#[\p{L}\p{N}_-]{1,64}$/u.test(query)) {
    const tag = query.slice(1).toLocaleLowerCase("cs-CZ");
    return { kind: "category", input, query, tag };
  }

  const explicitAi = AI_COMMAND.test(query);
  if (explicitAi) {
    const aiQuery = normalizedText(query.replace(AI_COMMAND, ""));
    return aiQuery ? { kind: "ai", input, query: aiQuery } : { kind: "empty" };
  }
  if (ADDRESS.test(query)) return { kind: "address", input, query };
  if (LOCALITY_PREFIX.test(query)) {
    return { kind: "locality", input, query: query.replace(LOCALITY_PREFIX, "") };
  }
  if (POI.test(query)) return { kind: "poi", input, query };

  const wordCount = query.split(" ").length;
  if (AI_ACTION.test(query) && (AI_CONSTRAINT.test(query) || wordCount >= 9)) {
    return { kind: "ai", input, query };
  }
  if (wordCount === 1 && /^\p{Lu}[\p{L}.'-]*$/u.test(query)) {
    return { kind: "locality", input, query };
  }
  return { kind: "place", input, query };
}
