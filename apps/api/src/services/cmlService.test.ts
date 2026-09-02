import assert from "node:assert/strict";
import test from "node:test";
import { advertisedCmlCapability } from "../config.js";
import { __resetCmlCache, askCml } from "./cmlService.js";

test("capabilities do not advertise a configured provider while the gateway gate is off", () => {
  assert.deepEqual(advertisedCmlCapability(false, "openai"), {
    cml: false,
    cmlProvider: "none"
  });
  assert.deepEqual(advertisedCmlCapability(true, "openai"), {
    cml: true,
    cmlProvider: "openai"
  });
});

test("AI generation stays disabled unless the deployment explicitly enables the gateway", async () => {
  const previous = process.env.MAPOS_AI_GATEWAY_ENABLED;
  delete process.env.MAPOS_AI_GATEWAY_ENABLED;
  __resetCmlCache();
  try {
    const answer = await askCml({
      cacheKey: "test",
      system: "Shrň data.",
      prompt: "Veřejný podklad",
      verifiedPublic: true
    });
    assert.equal(answer, null);
  } finally {
    if (previous === undefined) delete process.env.MAPOS_AI_GATEWAY_ENABLED;
    else process.env.MAPOS_AI_GATEWAY_ENABLED = previous;
    __resetCmlCache();
  }
});

test("unverified free-form context never reaches a configured gateway", async () => {
  const answer = await askCml({
    cacheKey: "free-form",
    system: "Shrň data.",
    prompt: "Text dodaný browserem"
  });
  assert.equal(answer, null);
});
