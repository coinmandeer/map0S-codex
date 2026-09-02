import assert from "node:assert/strict";
import test from "node:test";
import { countryFlagEmoji } from "./countryFlags";

test("country flags are generated locally from ISO alpha-2 codes", () => {
  assert.equal(countryFlagEmoji("cz"), "🇨🇿");
  assert.equal(countryFlagEmoji("ES"), "🇪🇸");
});

test("unknown country values use a neutral local fallback", () => {
  assert.equal(countryFlagEmoji("ALL"), "🌐");
  assert.equal(countryFlagEmoji(""), "🌐");
  assert.equal(countryFlagEmoji("C1"), "🌐");
});
