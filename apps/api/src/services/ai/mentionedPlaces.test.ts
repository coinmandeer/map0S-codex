import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_COORDINATES_SOURCE,
  normaliseMentionedPlaces,
  parseAnswerText,
  resolveMentionedPlaces,
  type PlaceGeocoder
} from "./mentionedPlaces.js";
import type { AiPlaceSearchRecord } from "./placeSearch.js";

const record = (title: string, longitude: number, latitude: number): AiPlaceSearchRecord => ({
  id: `geocode:${title}`,
  layerId: "osm-poi",
  title,
  category: "geocoded-place",
  longitude,
  latitude,
  sourceId: "mapos-geocoder"
});

const gazetteer: Record<string, AiPlaceSearchRecord[]> = {
  Vrchlabí: [record("Vrchlabí, Královéhradecký kraj", 15.6, 50.63)],
  "Kavárna Místo, Dlouhá 12, Praha": [record("Dlouhá 12, Praha 1", 14.43, 50.09)],
  Lhota: [record("Lhota, Zlínský kraj", 17.6, 49.2)],
  Nikde: [record("Praha, Česko", 14.42, 50.08)]
};
const geocode: PlaceGeocoder = async (query) => gazetteer[query] ?? [];

test("a submitted places list is normalised whatever the field names", () => {
  const places = normaliseMentionedPlaces([
    { name: "**Vrchlabí**" },
    { title: "Sněžka", lat: "50,7360", lon: 15.7399 },
    { placeName: "Vrchlabí" },
    { name: "x" },
    "Pec pod Sněžkou"
  ]);
  assert.deepEqual(places, [
    { name: "Vrchlabí" },
    { name: "Sněžka", latitude: 50.736, longitude: 15.7399 },
    { name: "Pec pod Sněžkou" }
  ]);
});

test("a fenced JSON block is read and removed from the prose", () => {
  const parsed = parseAnswerText(
    'Tady jsou obce:\n```json\n{"places":[{"name":"Vrchlabí"},{"name":"Lhota","address":"Lhota 5, 763 02"}]}\n```'
  );
  assert.equal(parsed.text, "Tady jsou obce:");
  assert.deepEqual(parsed.mentions, [
    { name: "Vrchlabí" },
    { name: "Lhota", address: "Lhota 5, 763 02" }
  ]);
});

test("a tool call written as text is recognised as one", () => {
  const parsed = parseAnswerText(
    '{"name":"submit_answer","arguments":{"text":"Hotovo","places":[{"name":"Vrchlabí"}]}}'
  );
  assert.equal(parsed.toolCall?.name, "submit_answer");
  assert.equal(parsed.toolCall?.arguments.text, "Hotovo");
  assert.deepEqual(parsed.mentions, [{ name: "Vrchlabí" }]);
});

test("coordinates and named list items become mentions; sentences do not", () => {
  const parsed = parseAnswerText(
    [
      "Doporučuji:",
      "1. **Kavárna Místo** – Dlouhá 12, Praha – skvělá káva",
      "- Sněžka: 50.7360, 15.7399",
      "- vezměte si vodu a pláštěnku.",
      "- Nejlepší je vyrazit brzy ráno, dokud je klid a nejsou tam davy turistů z autobusů."
    ].join("\n")
  );
  assert.deepEqual(parsed.mentions, [
    { name: "Kavárna Místo", address: "Dlouhá 12, Praha" },
    { name: "Sněžka", latitude: 50.736, longitude: 15.7399 }
  ]);
});

test("mentions resolve through the geocoder and reject namesakes", async () => {
  const resolved = await resolveMentionedPlaces(
    [
      { name: "Vrchlabí" },
      { name: "Kavárna Místo", address: "Dlouhá 12, Praha" },
      { name: "Nikde" },
      { name: "Neexistující" }
    ],
    geocode
  );
  assert.deepEqual(
    resolved.places.map((place) => [place.title, place.longitude, place.latitude]),
    [
      ["Vrchlabí", 15.6, 50.63],
      ["Kavárna Místo", 14.43, 50.09]
    ]
  );
  assert.deepEqual(resolved.sources, []);
});

test("model coordinates are a cited fallback, and pick the right namesake", async () => {
  const resolved = await resolveMentionedPlaces(
    [
      { name: "Lhota", latitude: 49.21, longitude: 17.61 },
      { name: "Lhota", address: "u Kladna", latitude: 50.2, longitude: 14.1 },
      { name: "Chata pod Sněžkou", latitude: 50.73, longitude: 15.74 }
    ],
    geocode
  );
  assert.equal(resolved.places[0]?.sourceId, "mapos-geocoder");
  assert.equal(resolved.places[1]?.sourceId, MODEL_COORDINATES_SOURCE.sourceId);
  assert.equal(resolved.places[2]?.category, "ai-mentioned-place");
  assert.deepEqual(resolved.sources, [MODEL_COORDINATES_SOURCE]);
});

test("a failing geocoder leaves the answer without pins instead of failing it", async () => {
  const resolved = await resolveMentionedPlaces([{ name: "Vrchlabí" }], async () => {
    throw new Error("down");
  });
  assert.deepEqual(resolved.places, []);
});
