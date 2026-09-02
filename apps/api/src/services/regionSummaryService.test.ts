import assert from "node:assert/strict";
import test from "node:test";
import { getRegionSummary } from "./regionSummaryService.js";

test("unknown region ids fail before storage or model access", async () => {
  await assert.rejects(getRegionSummary("attacker-selected-region"), /Region not found/);
});

test("known regions use a deterministic non-model fallback until cited context exists", async () => {
  const summary = await getRegionSummary("CZ-PLK");
  assert.equal(summary.model, null);
  assert.equal(summary.cached, false);
  assert.match(summary.text, /Plzeňský kraj/);
});
