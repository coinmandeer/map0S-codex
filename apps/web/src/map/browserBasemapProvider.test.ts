import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { directBrowserBasemapProviderId, isBasemapRuntimeError } from "./browserBasemapProvider.js";

describe("directBrowserBasemapProviderId", () => {
  it("maps catalogue basemaps to fixed provider slugs", () => {
    assert.equal(directBrowserBasemapProviderId("carto-voyager"), "carto-browser");
    assert.equal(directBrowserBasemapProviderId("openfreemap-liberty"), "openfreemap-browser");
    assert.equal(directBrowserBasemapProviderId("gibs-viirs"), "nasa-gibs-browser");
  });

  it("does not turn proxied or dynamic identifiers into telemetry dimensions", () => {
    assert.equal(directBrowserBasemapProviderId("mapy-outdoor"), null);
    assert.equal(directBrowserBasemapProviderId("google-roadmap"), null);
    assert.equal(directBrowserBasemapProviderId("private-filter=home"), null);
    assert.equal(directBrowserBasemapProviderId("https://tiles.example.test"), null);
  });

  it("never attributes an overlay error to the active basemap provider", () => {
    assert.equal(
      isBasemapRuntimeError({
        sourceId: "source-weather-radar",
        styleLoaded: true,
        hasPendingBasemap: true
      }),
      false
    );
    assert.equal(
      isBasemapRuntimeError({
        sourceId: "private-user-layer",
        styleLoaded: true,
        hasPendingBasemap: false
      }),
      false
    );
    assert.equal(
      isBasemapRuntimeError({ sourceId: "basemap", styleLoaded: true, hasPendingBasemap: false }),
      true
    );
    assert.equal(
      isBasemapRuntimeError({ sourceId: undefined, styleLoaded: false, hasPendingBasemap: true }),
      true
    );
    assert.equal(
      isBasemapRuntimeError({ sourceId: undefined, styleLoaded: true, hasPendingBasemap: true }),
      false
    );
  });
});
