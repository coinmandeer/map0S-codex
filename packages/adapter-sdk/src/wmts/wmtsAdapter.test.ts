import assert from "node:assert/strict";
import test from "node:test";
import { validateLayerManifestV2 } from "@mapos/layer-sdk";
import { wmtsAdapter } from "./wmtsAdapter.js";
import type { AdapterIo, DescribeRequest } from "../contract.js";
import { createBuiltInAdapterRegistry } from "../builtins.js";

function fixture(
  options: {
    crs?: string;
    origin?: string;
    rest?: boolean;
    limits?: boolean;
    dimension?: string;
    scale?: string;
  } = {}
) {
  return `<Capabilities version="1.0.0"><ServiceIdentification><Title>Satellite</Title></ServiceIdentification>
  <OperationsMetadata><Operation name="GetTile"><DCP><HTTP><Get href="https://tiles.example.org/render?vendor=ok"><Constraint name="GetEncoding"><AllowedValues><Value>KVP</Value></AllowedValues></Constraint></Get></HTTP></DCP></Operation></OperationsMetadata>
  <Contents><Layer><Identifier>snow</Identifier><Title>Snow cover</Title><Style isDefault="true"><Identifier>default</Identifier></Style><Format>image/png</Format>
  <Dimension><Identifier>Time</Identifier><Default>${options.dimension ?? "2026-09-01"}</Default></Dimension>
  <TileMatrixSetLink><TileMatrixSet>web</TileMatrixSet>${options.limits ? "<TileMatrixSetLimits/>" : ""}</TileMatrixSetLink>
  ${options.rest === false ? "" : '<ResourceURL resourceType="tile" format="image/png" template="https://tiles.example.org/{Time}/{Style}/{TileMatrixSet}/{TileMatrix}/{TileCol}/{TileRow}.png"/>'}</Layer>
  <TileMatrixSet><Identifier>web</Identifier><SupportedCRS>${options.crs ?? "urn:ogc:def:crs:EPSG::3857"}</SupportedCRS>
  ${[0, 1, 2].map((z) => `<TileMatrix><Identifier>web:${z}</Identifier><ScaleDenominator>${options.scale ?? 559082264.0287178 / 2 ** z}</ScaleDenominator><TopLeftCorner>${options.origin ?? "-20037508.342789244 20037508.342789244"}</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>${2 ** z}</MatrixWidth><MatrixHeight>${2 ** z}</MatrixHeight></TileMatrix>`).join("")}
  </TileMatrixSet></Contents></Capabilities>`;
}
async function request(xml = fixture()): Promise<DescribeRequest> {
  const io: AdapterIo = {
    text: async () => xml,
    json: async () => {
      throw Error("unexpected JSON");
    }
  };
  const probe = await wmtsAdapter.probe(
    new URL("https://tiles.example.org/wmts/1.0.0/WMTSCapabilities.xml"),
    io
  );
  return { probe: JSON.parse(JSON.stringify(probe)), sublayerIds: ["snow"], layerId: "test-snow" };
}

test("WMTS detection is unambiguous and does not claim WMS", () => {
  assert.equal(wmtsAdapter.detect(new URL("https://example.org/map?SERVICE=WMTS")), 1);
  assert.equal(wmtsAdapter.detect(new URL("https://example.org/wmts?service=WMS")), 0);
  assert.ok(createBuiltInAdapterRegistry());
});
test("REST follows advertised column/row order, matrix prefix and default time", async () => {
  const req = await request();
  const manifest = wmtsAdapter.describe(req);
  assert.equal(
    manifest.source.tileTemplate,
    "https://tiles.example.org/2026-09-01/default/web/web%3A{z}/{x}/{y}.png"
  );
  assert.deepEqual(manifest.queryPolicy, { strategy: "tile", minZoom: 0, maxZoom: 2 });
  assert.equal(validateLayerManifestV2(manifest).valid, true);
});
test("KVP uses advertised endpoint and preserves vendor arguments", async () => {
  const req = await request(fixture({ rest: false }));
  const template = wmtsAdapter.tileTemplate!(req);
  const url = new URL(template);
  assert.equal(url.pathname, "/render");
  assert.equal(url.searchParams.get("vendor"), "ok");
  assert.equal(url.searchParams.get("TILEMATRIX"), "web:{z}");
  assert.equal(url.searchParams.get("TILEROW"), "{y}");
  assert.equal(url.searchParams.get("Time"), "2026-09-01");
});
for (const [name, options] of Object.entries({
  geographic: { crs: "EPSG:4326" },
  shifted: { origin: "0 0" },
  invalidOrigin: { origin: "bad bad" },
  invalidScale: { scale: "bad" },
  limited: { limits: true },
  missingTime: { dimension: "" }
})) {
  test(`unsupported ${name} is shown as unavailable, not a broken layer`, async () => {
    const req = await request(fixture(options));
    assert.equal(req.probe.sublayers[0]?.selectable, false);
    assert.throws(() => wmtsAdapter.describe(req));
  });
}
test("multiple selections and tampered definitions cannot silently choose a layer", async () => {
  const req = await request();
  assert.throws(() => wmtsAdapter.describe({ ...req, sublayerIds: ["snow", "other"] }));
  req.probe.extra = {
    tileDefinitions: '{"snow":{"template":"https://x.test/{Time}/{z}/{x}/{y}","min":0,"max":2}}'
  };
  assert.throws(() => wmtsAdapter.describe(req));
});
test("capabilities comments cannot inject a matrix or layer", async () => {
  const req = await request(
    fixture().replace("<Contents>", "<Contents><!--<Layer><Identifier>fake</Identifier></Layer>-->")
  );
  assert.deepEqual(
    req.probe.sublayers.map((s) => s.id),
    ["snow"]
  );
});
