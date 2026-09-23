import test from "node:test";
import assert from "node:assert/strict";
import { createProductionGuideCollectors } from "./guideComposition.js";
test("a common district title without a verified identity cannot become a different city's encyclopedia", async () => {
  const result = await createProductionGuideCollectors().encyclopedia!(
    {
      regionId: "district-tarragona",
      name: "Eixample",
      level: "locality",
      lang: "cs",
      center: { longitude: 1.25, latitude: 41.12 },
      bbox: [1.24, 41.11, 1.26, 41.13]
    },
    new AbortController().signal
  );
  assert.deepEqual(result.value, []);
});
