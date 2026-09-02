import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertFeatureQueryResultV2, featureV2ToV1 } from "@mapos/layer-sdk";
import { earthquakeFixtureResult } from "./earthquakeFixture.js";

const fixtureBbox = [14.3, 50, 14.5, 50.2] as [number, number, number, number];

describe("earthquakes v2 fixture provider", () => {
  it("enforces the server-side 100 feature ceiling even for a hostile limit", () => {
    const result = earthquakeFixtureResult(fixtureBbox, { limit: "10000" });
    assertFeatureQueryResultV2(result);
    assert.equal(result.meta.limit, 100);
    assert.equal(result.meta.returned, 100);
    assert.equal(result.meta.truncated, true);
    assert.equal(result.data.features.length, 100);
  });

  it("applies filters before limiting and preserves the legacy renderer shape", () => {
    const result = earthquakeFixtureResult(fixtureBbox, {
      limit: "2",
      minMagnitude: "6"
    });
    assertFeatureQueryResultV2(result);
    assert.equal(result.meta.limit, 2);
    assert.equal(result.data.features.length, 2);
    for (const feature of result.data.features) {
      const legacy = featureV2ToV1(feature);
      assert.equal(legacy.properties.layerId, "earthquakes");
      assert.ok(Number(legacy.properties.magnitude) >= 6);
    }
  });

  it("is deterministic for offline API/web contract tests", () => {
    const first = earthquakeFixtureResult(fixtureBbox, { limit: "3" });
    const second = earthquakeFixtureResult(fixtureBbox, { limit: "3" });
    assert.deepEqual(second, first);
  });
});
