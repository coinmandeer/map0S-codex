import assert from "node:assert/strict";
import { test } from "node:test";
import type { Bbox } from "@mapos/layer-sdk";
import {
  anchoredQuestFeature,
  registerQuestSource,
  resetQuestSources,
  unavailableSourcesNotice,
  type QuestAnchor,
  type QuestSourceAdapter
} from "./anchors.js";
import {
  ANCHOR_CELL_DEG,
  DEFAULT_ANCHOR_REFRESH_MS,
  MAX_CELLS_PER_SWEEP,
  cellsFor,
  __testing
} from "./questAnchorCache.js";

const CACHE: QuestAnchor = {
  ref: "oc:de:OC1234",
  name: "Keš u splavu",
  lng: 14.42,
  lat: 50.08,
  category: "geocache",
  kind: "cache",
  weight: 3.5,
  radiusM: 60,
  externalUrl: "https://opencaching.de/viewcache.php?wp=OC1234",
  description: "Keš OC1234"
};

function source(overrides: Partial<QuestSourceAdapter> = {}): QuestSourceAdapter {
  return {
    id: "test-source",
    label: "Test",
    attribution: "test",
    async anchors() {
      return [CACHE];
    },
    async resolve() {
      return CACHE;
    },
    ...overrides
  };
}

test("a viewport maps to stable grid cells, so panning back reuses the earlier sweep", () => {
  const cells = cellsFor([14.3, 50.0, 14.4, 50.1]);
  assert.deepEqual(
    cells.map((cell) => cell.key),
    cellsFor([14.31, 50.01, 14.39, 50.09]).map((cell) => cell.key),
    "two viewports inside the same cells produce the same keys"
  );
  // Each cell's bbox is the grid square itself, not the viewport that asked about it — that is
  // what makes a sweep reusable by the next, differently framed request.
  for (const cell of cells) {
    const [west, south, east, north] = cell.bbox;
    assert.ok(Math.abs(east - west - ANCHOR_CELL_DEG) < 1e-9);
    assert.ok(Math.abs(north - south - ANCHOR_CELL_DEG) < 1e-9);
  }
});

test("cells cover the whole viewport, including across the prime meridian", () => {
  const cells = cellsFor([-0.1, 51.4, 0.1, 51.6]);
  assert.ok(cells.length >= 4, "a viewport spanning zero longitude is not collapsed to one cell");
  const keys = new Set(cells.map((cell) => cell.key));
  assert.equal(keys.size, cells.length, "no cell is emitted twice");
});

test("a regional viewport stops enumerating instead of fanning out into a sweep", () => {
  // The cap is the guard that keeps a zoomed-out map from becoming hundreds of upstream calls;
  // `refreshAnchorsForBbox` reads the overflow and serves from cache only.
  const cells = cellsFor([-10, 35, 30, 60] as Bbox);
  assert.ok(cells.length > MAX_CELLS_PER_SWEEP);
});

test("a source states how long its sweep stays good, and otherwise gets the default", () => {
  assert.equal(__testing.refreshAfterMs(source()), DEFAULT_ANCHOR_REFRESH_MS);
  assert.equal(__testing.refreshAfterMs(source({ refreshAfterMs: 60_000 })), 60_000);
});

test("an anchor row round-trips through the cache without losing the optional fields", () => {
  const now = new Date("2026-09-03T10:00:00.000Z");
  const row = __testing.anchorRow(CACHE, "opencaching", now);
  assert.equal(row.ref, CACHE.ref);
  assert.equal(row.sourceId, "opencaching");
  assert.equal(row.refreshedAt, now);
  assert.equal(row.weight, 3.5);
  assert.equal(row.radiusM, 60);
  assert.equal(row.externalUrl, CACHE.externalUrl);

  // Reading back drops nothing that the derived quest depends on: the external link is a
  // licence condition for Opencaching, and the radius decides what counts as being there.
  const restored = __testing.anchorFromRow({
    ...row,
    geog: null,
    kind: CACHE.kind ?? null,
    weight: row.weight,
    radiusM: row.radiusM,
    description: row.description,
    externalUrl: row.externalUrl
  } as never);
  assert.deepEqual(restored, CACHE);
});

test("an anchor becomes a pin that says what there is to do and who provided it", () => {
  resetQuestSources();
  const adapter = source({ id: "opencaching", label: "Opencaching", attribution: "CC-BY-SA" });
  const feature = anchoredQuestFeature(adapter, CACHE);
  assert.deepEqual(feature.geometry, { type: "Point", coordinates: [14.42, 50.08] });
  assert.equal(feature.properties.layerId, "game-quests");
  assert.equal(feature.properties.category, "geocache", "the legend keys off the category");
  assert.equal(feature.properties.name, "Keš u splavu");
  assert.match(String(feature.properties.questTitle), /Najdi keš/);
  assert.equal(feature.properties.sourceLabel, "Opencaching");
  assert.equal(feature.properties.attribution, "CC-BY-SA");
  assert.equal(feature.properties.externalUrl, CACHE.externalUrl);
  assert.ok(Number(feature.properties.rewardPoints) > 0);
});

test("an empty map explains itself only when every source is actually blocked", () => {
  resetQuestSources();
  registerQuestSource(source({ id: "blocked", unavailableReason: () => "Chybí OKAPI klíč" }));
  assert.match(String(unavailableSourcesNotice()), /Chybí OKAPI klíč/);

  // With one working source, an empty viewport really is empty; blaming a missing key would be
  // wrong and would hide the fact that there is nothing here.
  registerQuestSource(source({ id: "working" }));
  assert.equal(unavailableSourcesNotice(), undefined);
  resetQuestSources();
});
