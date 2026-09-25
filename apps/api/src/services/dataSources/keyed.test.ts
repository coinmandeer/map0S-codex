import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Bbox } from "@mapos/layer-sdk";
import { capabilities, config } from "../../config.js";
import { dataSourceProviders } from "./index.js";
import { keyedSources } from "./keyed.js";

const PRAGUE: Bbox = [14.38, 50.06, 14.47, 50.11];

describe("keyed data sources", () => {
  it("names the missing environment variable instead of failing vaguely", async () => {
    // These specs run without keys, which is exactly the fresh-clone case: the layer has to
    // explain what to set, not just come back empty.
    for (const source of keyedSources) {
      const provider = dataSourceProviders.find((p) => p.id === source.id)!;
      const result = await provider.features!({ bbox: PRAGUE, query: {} });

      assert.equal(result.features.length, 0, `${source.id} should not invent data`);
      assert.match(
        result.notice ?? "",
        /chybí klíč [A-Z_]+/,
        `${source.id} should name its env var, got: ${result.notice}`
      );
    }
  });

  it("reports a capability flag for every keyed layer", () => {
    // The manifest hides a layer via requiresCapability; if the flag isn't in /config the
    // layer would be hidden forever, key or no key.
    const caps = capabilities();
    for (const name of ["ocm", "mapillary", "firms", "openaq", "ebird", "ticketmaster"]) {
      assert.ok(name in caps, `/config does not report "${name}"`);
      assert.equal(typeof caps[name], "boolean");
    }
  });

  it("never leaks a key value into the capabilities payload", () => {
    // Server credentials remain private; the restricted UI Kit browser key is explicit.
    for (const [name, value] of Object.entries(capabilities())) {
      if (name === "cmlProvider") continue;
      if (name === "googlePlacesPublicKey") {
        assert.equal(value, config.googlePlacesPublicKey ?? "");
        if (config.tileKeys.google) assert.notEqual(value, config.tileKeys.google);
        continue;
      }
      assert.equal(typeof value, "boolean", `${name} should be a flag, not a value`);
    }
  });
});
