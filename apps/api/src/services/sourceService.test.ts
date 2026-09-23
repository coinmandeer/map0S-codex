import assert from "node:assert/strict";
import test from "node:test";
import { validateLayerManifestV2 } from "@mapos/layer-sdk";
import { fixtureAdapterIo } from "./sourceFixtures.js";
import {
  describeSource,
  detectSourceCandidates,
  probeSource,
  SourceRequestError
} from "./sourceService.js";

/** The fixture WMS, which is also what the offline server and the wizard's e2e read. */
const WMS_URL = "https://example.wms/service?service=WMS&request=GetCapabilities";
const ARCGIS_URL = "https://example.arcgis/arcgis/rest/services/test/MapServer";

test("an address is refused before any request when nothing recognises it", async () => {
  await assert.rejects(
    probeSource("https://example.org/data.json", fixtureAdapterIo),
    (error: SourceRequestError) => error.status === 422 && /neumíme rozpoznat/.test(error.message)
  );
});

test("a non-https or malformed address is a bad request, not an upstream failure", async () => {
  for (const bad of ["", "  ", "not a url", "http://example.wms/service", "ftp://x/y"]) {
    await assert.rejects(
      probeSource(bad, fixtureAdapterIo),
      (error: SourceRequestError) => error.status === 400,
      bad
    );
  }
});

test("MapLibre's pmtiles scheme is unwrapped rather than rejected", () => {
  // People copy `pmtiles://https://…` out of a style, and it names a real URL.
  const candidates = detectSourceCandidates("https://x.org/a.pmtiles");
  assert.equal(candidates[0]?.adapterId, "pmtiles");
});

test("a WMS URL probes into a manifest that validates and keeps its legend", async () => {
  const { probe, candidates } = await probeSource(WMS_URL, fixtureAdapterIo);
  assert.equal(probe.adapterId, "wms");
  assert.equal(candidates[0]?.adapterId, "wms");
  assert.equal(probe.title, "Zkušební mapová služba");
  assert.deepEqual(
    probe.sublayers.filter((sublayer) => sublayer.selectable).map((sublayer) => sublayer.id),
    ["zaplavy", "vodni-toky"]
  );

  const manifest = describeSource({
    probe,
    sublayerIds: ["zaplavy"],
    name: "Zaplavy",
    layerId: "src-test"
  });
  assert.equal(manifest.id, "src-test");
  assert.equal(manifest.name, "Zaplavy");
  assert.equal(validateLayerManifestV2(manifest).valid, true);
  assert.equal(manifest.legend?.type, "image");
  assert.deepEqual(manifest.attribution, [
    { label: "Zkušební poskytovatel", url: "https://example.wms/about" }
  ]);
  const template = manifest.source.type === "raster-tiles" ? manifest.source.tileTemplate : "";
  assert.ok(template?.endsWith("&bbox={bbox-epsg-3857}"));
  assert.ok(template?.includes("layers=zaplavy"));
});

test("an ArcGIS URL reaches the ArcGIS adapter through the same call", async () => {
  const { probe } = await probeSource(ARCGIS_URL, fixtureAdapterIo);
  assert.equal(probe.adapterId, "arcgis");
  assert.equal(probe.delivery, "tiles");
  const manifest = describeSource({ probe, sublayerIds: [], layerId: "src-arcgis" });
  assert.equal(validateLayerManifestV2(manifest).valid, true);
});

test("a sublayer the service never published is refused", async () => {
  const { probe } = await probeSource(WMS_URL, fixtureAdapterIo);
  assert.throws(
    () => describeSource({ probe, sublayerIds: ["neexistuje"], layerId: "x" }),
    (error: SourceRequestError) => error.status === 422 && /neexistuje/.test(error.message)
  );
});

test("a probe whose adapter is gone fails describing rather than storing a layer nothing draws", async () => {
  const { probe } = await probeSource(WMS_URL, fixtureAdapterIo);
  assert.throws(
    () =>
      describeSource({ probe: { ...probe, adapterId: "retired" }, sublayerIds: [], layerId: "x" }),
    (error: SourceRequestError) => error.status === 422
  );
});

test("an unreachable service reports what happened, not a generic failure", async () => {
  await assert.rejects(
    probeSource("https://unknown.wms/wms", fixtureAdapterIo),
    (error: SourceRequestError) => error.status === 422 && /offline/.test(error.message)
  );
});

test("WMTS survives the client round trip and yields a renderable raster manifest", async () => {
  const { probe, candidates } = await probeSource(
    "https://example.wmts/wmts?SERVICE=WMTS",
    fixtureAdapterIo
  );
  assert.equal(candidates[0]?.adapterId, "wmts");
  const manifest = describeSource({
    probe: JSON.parse(JSON.stringify(probe)),
    sublayerIds: ["snow"],
    layerId: "source-snow"
  });
  assert.equal(validateLayerManifestV2(manifest).valid, true);
  assert.equal(manifest.source.tileTemplate, "https://example.wmts/tiles/snow/{z}/{y}/{x}.png");
  assert.throws(
    () =>
      describeSource({
        probe: { ...probe, extra: { tileDefinitions: "{" } },
        sublayerIds: ["snow"]
      }),
    (error: SourceRequestError) => error.status === 422
  );
});
