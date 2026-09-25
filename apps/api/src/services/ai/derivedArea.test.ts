import assert from "node:assert/strict";
import test from "node:test";
import { isMapResultArtifact } from "@mapos/layer-sdk";
import { deriveRadiusArea } from "./derivedArea.js";
import { answerArtifacts } from "./mapArtifacts.js";

test("derived distance area closes rings, preserves provenance and splits at date line", () => {
  for (const lng of [14, 179.9, -179.9]) {
    const draft = deriveRadiusArea(lng, 36, 100);
    const artifacts = answerArtifacts(
      {
        execution: "deterministic",
        intent: "layer_query",
        text: "",
        cards: [],
        sources: [],
        followUps: [],
        mapResults: [draft]
      },
      "conversation",
      1
    );
    assert.equal(artifacts.length, 1);
    assert.equal(isMapResultArtifact(artifacts[0]), true);
    const geometry = artifacts[0]!.data.features[0]!.geometry;
    assert.equal(geometry.type, lng === 14 ? "Polygon" : "MultiPolygon");
    assert.match(artifacts[0]!.derived!.description, /nejde o dostupnost/);
    const revised = answerArtifacts(
      {
        execution: "deterministic",
        intent: "layer_query",
        text: "",
        cards: [],
        sources: [],
        followUps: [],
        mapResults: [draft]
      },
      "conversation",
      2
    );
    assert.equal(revised[0]!.id, artifacts[0]!.id, "revision replaces one artifact");
  }
  assert.throws(() => deriveRadiusArea(14, 90, 100));
});
