import test from "node:test";
import assert from "node:assert/strict";
import { answerArtifacts, memoryMapArtifacts } from "./mapArtifacts.js";
import type { AiChatAnswer } from "./chatService.js";

test("raster selections persist as owned stable source references without inventing geometry", async () => {
  const answer: AiChatAnswer = {
    text: "Historická světla a pokryv krajiny",
    intent: "layer_query",
    execution: "deterministic",
    sources: [],
    followUps: [],
    cards: [
      {
        type: "layer",
        title: "Vrstvy",
        layerIds: ["dark-sky", "esa-worldcover", "dark-sky", "unknown"],
        opacityByLayer: { "dark-sky": 0.4 }
      }
    ]
  };
  const first = answerArtifacts(answer, "session-a", 1, "run-1");
  assert.equal(first.length, 2);
  assert.equal(first[0]!.registeredRaster?.layerId, "dark-sky");
  assert.equal(first[0]!.legend?.time, "2016");
  assert.equal(first[0]!.style.opacity, 0.4);
  assert.deepEqual(first[0]!.data.features, []);
  const next = answerArtifacts(answer, "session-a", 2, "run-2");
  assert.equal(first[0]!.id, next[0]!.id);
  assert.notEqual(first[0]!.id, answerArtifacts(answer, "session-b", 1)[0]!.id);
  const repository = memoryMapArtifacts();
  await repository.put("owner", first[0]!);
  await repository.put("owner", next[0]!);
  assert.equal((await repository.get("owner", first[0]!.id))?.revision, 2);
  assert.equal(await repository.get("other", first[0]!.id), null);
});
