import test from "node:test";
import assert from "node:assert/strict";
import { CATALOG_GROUPS, isMapScenePatch, type MapContextSnapshot } from "@mapos/layer-sdk";
import { answerScenePatch } from "./scenePatch.js";
import type { AiChatAnswer } from "./chatService.js";

test("scene compiler scopes categories, hides unrelated layers and never accepts arbitrary sources", () => {
  const item = CATALOG_GROUPS.flatMap((g) => g.items).find(
    (i) => i.facet && i.values?.includes("cafe")
  )!;
  assert.ok(item);
  const snapshot: MapContextSnapshot = {
    schema: "mapos.map-context",
    schemaVersion: "1.0.0",
    revision: 2,
    basemapId: "carto-light",
    view: { longitude: 0, latitude: 0, zoom: 5 },
    time: null,
    areaId: null,
    selectedFeatureIds: [],
    planRevision: null,
    layers: {
      [item.layer]: { visible: true, opacity: 0.4, filters: { [item.facet!]: ["church"] } },
      aurora: { visible: true, opacity: 0.8, filters: {} }
    }
  };
  const answer: AiChatAnswer = {
    execution: "deterministic",
    intent: "question",
    text: "",
    sources: [],
    followUps: [],
    cards: [
      {
        type: "layer",
        title: "Kavárny",
        layerIds: [item.id, "https://example.org/evil"],
        opacityByLayer: { [item.id]: 0.6 },
        time: "2026-09-24T22:00:00Z"
      }
    ]
  };
  const patch = answerScenePatch(answer, snapshot, "conversation", "run", 3, "kavárny")!;
  assert.ok(isMapScenePatch(patch));
  assert.deepEqual(patch.layers![item.layer]!.filters[item.facet!], item.values);
  assert.equal(patch.layers![item.layer]!.opacity, 0.6);
  assert.equal(patch.time, "2026-09-24T22:00:00Z");
  assert.equal(patch.layers!.aurora!.visible, false);
  assert.equal(patch.layers!["https://example.org/evil"], undefined);
  assert.equal(isMapScenePatch({ ...patch, executable: "evil" }), false);
  assert.equal(
    isMapScenePatch({ ...patch, layers: { invalid: { visible: true, opacity: 2, filters: {} } } }),
    false
  );
});
