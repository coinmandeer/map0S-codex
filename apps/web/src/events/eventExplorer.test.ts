import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeoFeature } from "@mapos/layer-sdk";
import { buildEventExplorerItems, eventPriceLabel } from "./eventExplorer";

function feature(
  id: string,
  coordinates: [number, number],
  properties: Partial<GeoFeature["properties"]> = {}
): GeoFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties: {
      id,
      name: id,
      category: "Music",
      layerId: "events",
      ...properties
    }
  };
}

describe("event explorer presentation", () => {
  it("keeps unknown prices distinct from free and formats a real range", () => {
    assert.equal(eventPriceLabel(feature("unknown", [14.4, 50.1]).properties), "Cena neuvedena");
    assert.equal(
      eventPriceLabel(feature("free", [14.4, 50.1], { free: true }).properties),
      "Zdarma"
    );
    assert.equal(
      eventPriceLabel(
        feature("paid", [14.4, 50.1], { priceFrom: 250, priceTo: 500, currency: "CZK" }).properties
      ),
      "250–500 CZK"
    );
  });

  it("filters by distance and orders dated events before missing dates", () => {
    const items = buildEventExplorerItems(
      [
        feature("missing", [14.401, 50.101]),
        feature("later", [14.402, 50.102], { startsAt: "2026-09-09T18:00:00Z" }),
        feature("soon", [14.403, 50.103], { startsAt: "2026-09-04T18:00:00Z" }),
        feature("far", [15.4, 50.1], { startsAt: "2026-09-03T18:00:00Z" })
      ],
      { lng: 14.4, lat: 50.1 },
      25
    );
    assert.deepEqual(
      items.map(({ id }) => id),
      ["soon", "later", "missing"]
    );
    assert.ok(items.every(({ distanceM }) => distanceM <= 25_000));
  });
});
