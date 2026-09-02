import assert from "node:assert/strict";
import test from "node:test";
import { PLACE_SOURCE_BY_ID } from "@mapos/layer-sdk";
import { capabilities, config } from "./config.js";

test("prototype Park4Night capability follows its technical operator switch", () => {
  const previous = process.env.PARK4NIGHT_ENABLED;
  try {
    assert.equal(PLACE_SOURCE_BY_ID.park4night.releaseRights.state, "blocked");

    process.env.PARK4NIGHT_ENABLED = "0";
    assert.equal(config.park4nightEnabled, false);
    assert.equal(capabilities().park4night, false);

    process.env.PARK4NIGHT_ENABLED = "1";
    assert.equal(config.park4nightEnabled, true);
    assert.equal(capabilities().park4night, true);
  } finally {
    if (previous === undefined) delete process.env.PARK4NIGHT_ENABLED;
    else process.env.PARK4NIGHT_ENABLED = previous;
  }
});
