import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capabilities } from "../config.js";
import {
  fetchBasemapTile,
  providerCapabilities,
  TileProviderUnavailableError
} from "./basemapService.js";

describe("basemap tile proxy", () => {
  it("advertises every provider under a flag the config actually sets", () => {
    // The two lists are computed in different modules to avoid an import cycle, so a rename on
    // one side would otherwise silently hide a background that has a perfectly good key.
    const flags = capabilities();
    for (const [provider, flag] of Object.entries(providerCapabilities())) {
      assert.equal(
        flag in flags,
        true,
        `${provider} hides behind "${flag}", which /config never reports`
      );
    }
  });

  it("refuses an unknown provider rather than building a URL from user input", async () => {
    await assert.rejects(
      () => fetchBasemapTile("../evil", { mapset: "basic", z: 1, x: 1, y: 1, retina: false }),
      TileProviderUnavailableError
    );
  });

  it("refuses a mapset the provider doesn't have", async () => {
    await assert.rejects(
      () => fetchBasemapTile("mapy", { mapset: "not-a-mapset", z: 1, x: 1, y: 1, retina: false }),
      TileProviderUnavailableError
    );
  });

  it("reports a missing key as unavailable, not as a broken upstream", async () => {
    const provider = Object.entries(providerCapabilities()).find(
      ([, flag]) => !capabilities()[flag]
    );
    if (!provider) return; // A deployment with every key set has nothing to assert here.
    await assert.rejects(
      () => fetchBasemapTile(provider[0], { mapset: "basic", z: 1, x: 1, y: 1, retina: false }),
      TileProviderUnavailableError
    );
  });
});
