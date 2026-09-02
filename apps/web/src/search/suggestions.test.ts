import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEmptySuggestions } from "./suggestions.js";

describe("buildEmptySuggestions", () => {
  it("builds deterministic sections without reading browser state", () => {
    const sections = buildEmptySuggestions({
      recent: [
        { id: "a", query: "Praha", label: "Praha", kind: "locality", usedAt: 2 },
        { id: "b", query: "Brno", label: "Brno", kind: "locality", usedAt: 1 }
      ],
      lastLocation: { label: "Poslední místo", coordinates: { lat: 50, lng: 14 } },
      modes: [{ id: "trip", label: "Výlet", mode: "trip" }]
    });

    assert.deepEqual(
      sections.map((section) => section.id),
      ["recent", "location", "quick-actions", "mode"]
    );
    assert.deepEqual(
      sections[0]?.items.map((item) => item.label),
      ["Praha", "Brno"]
    );
    assert.deepEqual(
      sections[1]?.items.map((item) => item.label),
      ["Moje poloha", "Poslední místo"]
    );
    assert.deepEqual(
      sections[2]?.items.map((item) => item.action.type),
      ["open-map-picker", "open-saved-places", "new-plan"]
    );
  });

  it("deduplicates and caps recent suggestions", () => {
    const sections = buildEmptySuggestions({
      maxRecent: 1,
      includeCurrentLocation: false,
      quickActions: [],
      recent: [
        { id: "a", query: "Praha", label: "Praha", kind: "place", usedAt: 2 },
        { id: "b", query: "praha", label: "Praha 2", kind: "place", usedAt: 1 },
        { id: "c", query: "Brno", label: "Brno", kind: "place", usedAt: 0 }
      ]
    });
    assert.deepEqual(
      sections[0]?.items.map((item) => item.label),
      ["Praha"]
    );
  });

  it("honors zero recent capacity and selected quick actions", () => {
    const sections = buildEmptySuggestions({
      maxRecent: 0,
      includeCurrentLocation: false,
      recent: [{ id: "a", query: "Praha", label: "Praha", kind: "place", usedAt: 1 }],
      quickActions: ["map-picker"]
    });
    assert.deepEqual(
      sections.map((section) => section.id),
      ["quick-actions"]
    );
    assert.equal(sections[0]?.items[0]?.action.type, "open-map-picker");
  });

  it("drops invalid location and duplicate mode input", () => {
    const sections = buildEmptySuggestions({
      includeCurrentLocation: false,
      quickActions: [],
      lastLocation: { label: "Invalid", coordinates: { lat: 91, lng: 14 } },
      modes: [
        { id: "one", label: "První", mode: "trip" },
        { id: "two", label: "Druhá", mode: "trip" },
        { id: "bad", label: "Skrytý\nrežim", mode: "bad" }
      ]
    });
    assert.deepEqual(
      sections.map((section) => section.id),
      ["mode"]
    );
    assert.equal(sections[0]?.items.length, 1);
  });

  it("returns JSON-serializable action data", () => {
    const sections = buildEmptySuggestions({
      lastLocation: { label: "Doma", coordinates: { lat: 50, lng: 14 } }
    });
    assert.doesNotThrow(() => JSON.stringify(sections));
  });
});
