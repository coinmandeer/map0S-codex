import assert from "node:assert/strict";
import test from "node:test";
import { config, capabilities } from "./config.js";

test("public Places key is withheld without an explicit provider hard-cap attestation", () => {
  const names = [
    "GOOGLE_PLACES_BROWSER_KEY",
    "GOOGLE_PLACES_FREE_CAP_VERIFIED",
    "GOOGLE_PLACES_TRIAL_VERIFIED_UNTIL",
    "GOOGLE_MAPS_API_KEY"
  ];
  const before = names.map((name) => process.env[name]);
  try {
    process.env.GOOGLE_MAPS_API_KEY = "server-only";
    process.env.GOOGLE_PLACES_BROWSER_KEY = "origin-restricted-browser-key";
    delete process.env.GOOGLE_PLACES_FREE_CAP_VERIFIED;
    delete process.env.GOOGLE_PLACES_TRIAL_VERIFIED_UNTIL;
    assert.equal(config.googlePlacesPublicKey, undefined);
    assert.equal(capabilities().googlePlacesUi, false);
    assert.equal(capabilities().googlePlacesPublicKey, "");
    process.env.GOOGLE_PLACES_TRIAL_VERIFIED_UNTIL = new Date(Date.now() + 60_000).toISOString();
    assert.equal(config.googlePlacesPublicKey, "origin-restricted-browser-key");
    process.env.GOOGLE_PLACES_TRIAL_VERIFIED_UNTIL = new Date(Date.now() - 60_000).toISOString();
    assert.equal(config.googlePlacesPublicKey, undefined);
    process.env.GOOGLE_PLACES_FREE_CAP_VERIFIED = "1";
    assert.equal(capabilities().googlePlacesUi, true);
    assert.equal(config.googlePlacesPublicKey, "origin-restricted-browser-key");
    delete process.env.GOOGLE_PLACES_BROWSER_KEY;
    assert.equal(config.googlePlacesPublicKey, undefined);
  } finally {
    names.forEach((name, index) => {
      if (before[index] === undefined) delete process.env[name];
      else process.env[name] = before[index];
    });
  }
});
