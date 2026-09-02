import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanShareUrl, planShareTokenFromLocation } from "./planSharing.js";

const TOKEN = "aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_-abcde";

test("plan share links use a stable SPA path and accept only the exact bearer-token grammar", () => {
  assert.equal(TOKEN.length, 43);
  assert.equal(
    buildPlanShareUrl("https://mapos.example/", TOKEN),
    `https://mapos.example/s?mode=planning#plan=${TOKEN}`
  );
  assert.equal(planShareTokenFromLocation("/s", `#plan=${TOKEN}`), TOKEN);
  assert.equal(planShareTokenFromLocation("/s/", `#plan=${TOKEN}`), TOKEN);
  assert.equal(planShareTokenFromLocation("/s", "#plan=short"), null);
  assert.equal(planShareTokenFromLocation("/s", "#plan=%"), null);
  assert.equal(planShareTokenFromLocation("/other", `#plan=${TOKEN}`), null);
  assert.throws(() => buildPlanShareUrl("https://mapos.example", "bad"));
});
