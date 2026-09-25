import assert from "node:assert/strict";
import test from "node:test";
import { createMapyPlaceSearch } from "./mapyPlaceSearch.js";

test("cold-cell category fallback retains only source-confirmed cafes inside the route area", async () => {
  let calls = 0;
  const search = createMapyPlaceSearch(async (input) => {
    calls++;
    assert.deepEqual(input.bbox, [-4.5, 36.6, -4.3, 36.8]);
    assert.equal(input.type, "poi");
    assert.ok(input.signal);
    return [
      {
        name: "Café Málaga",
        label: "Cafetería",
        location: "Málaga",
        position: { lon: -4.42, lat: 36.72 },
        type: "poi"
      },
      {
        name: "Café Praha",
        label: "Cafetería",
        location: "Praha",
        position: { lon: 14.42, lat: 50.08 },
        type: "poi"
      },
      {
        name: "Café Museum",
        label: "Museum",
        location: "Málaga",
        position: { lon: -4.42, lat: 36.72 },
        type: "poi"
      }
    ];
  });
  const items = await search(
    { categories: ["food.cafe"], limit: 8 },
    [-4.5, 36.6, -4.3, 36.8],
    ["cafe"],
    new AbortController().signal
  );
  assert.ok(calls > 0 && calls <= 2);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.title, "Café Málaga");
  assert.equal(items[0]!.source.providerId, "mapy");
  assert.equal(
    items[0]!.sourceFeatureId,
    undefined,
    "a provider ID must not be fabricated from coordinates"
  );
});

test("name search needs no guessed category and propagates cancellation", async () => {
  const search = createMapyPlaceSearch(async ({ query }) => {
    assert.equal(query, "Alcazaba");
    return [
      {
        name: "Alcazaba",
        label: "Palace",
        location: "Málaga",
        position: { lon: -4.416, lat: 36.721 },
        type: "poi"
      }
    ];
  });
  const query = { query: "Alcazaba", limit: 5 };
  assert.equal(
    (await search(query, [-4.5, 36.6, -4.3, 36.8], [], new AbortController().signal)).length,
    1
  );
  await assert.rejects(search(query, [-4.5, 36.6, -4.3, 36.8], [], AbortSignal.abort()));
});
