import assert from "node:assert/strict";
import test from "node:test";
import { validateLayerManifestV2 } from "@mapos/layer-sdk";
import type { AdapterIo } from "../contract.js";
import { SourceProbeError } from "../contract.js";
import { createAdapterRegistry } from "../registry.js";
import { flattenWmsLayers, parseWmsCapabilities } from "./capabilities.js";
import { wmsAdapter } from "./wmsAdapter.js";

test("WMS time domains inherit compactly and child overrides do not affect siblings", () => {
  const xml = `<WMS_Capabilities version="1.3.0"><Capability><Layer>
    <Title>Group</Title><CRS>EPSG:3857</CRS>
    <Dimension name="time" units="ISO8601" default="2026-09-01" nearestValue="1">2000-01-01/2026-09-01/P1D</Dimension>
    <Layer><Name>inherited</Name><Title>Inherited</Title></Layer>
    <Layer><Name>override</Name><Title>Override</Title>
      <Dimension name="time" units="ISO8601" default="2026-09-02" nearestValue="0">2026-09-01,2026-09-02</Dimension>
    </Layer></Layer></Capability></WMS_Capabilities>`;
  const layers = flattenWmsLayers(parseWmsCapabilities(xml).layers);
  assert.deepEqual(layers[1]?.time, {
    units: "ISO8601",
    values: "2000-01-01/2026-09-01/P1D",
    default: "2026-09-01",
    nearestValue: true
  });
  assert.deepEqual(layers[2]?.time, {
    units: "ISO8601",
    values: "2026-09-01,2026-09-02",
    default: "2026-09-02",
    nearestValue: false
  });
  assert.notEqual(layers[0]?.time, layers[1]?.time);
});

test("WMS 1.1 Extent carries values and flags while Dimension declares units", () => {
  const xml = `<WMT_MS_Capabilities version="1.1.1"><Capability><Layer>
    <Name>weather</Name><Title>Weather</Title><SRS>EPSG:3857</SRS>
    <Dimension name="time" units="ISO8601"/>
    <Extent name="time" default="current" multipleValues="0" current="1">2020-01-01/current/P1D</Extent>
  </Layer></Capability></WMT_MS_Capabilities>`;
  assert.deepEqual(parseWmsCapabilities(xml).layers[0]?.time, {
    units: "ISO8601",
    values: "2020-01-01/current/P1D",
    default: "current",
    multipleValues: false,
    current: true
  });
  assert.throws(
    () => parseWmsCapabilities(xml.replace("2020-01-01/current/P1D", "x".repeat(65_537))),
    /time domain exceeds/
  );
});

/** Shaped after the EEA and GeoServer documents: a namespaced root, an undrawable group holding
 *  drawable children, inherited CRS, a legend graphic, and a GetMap URL that differs from the
 *  capabilities URL. */
const CAPABILITIES_130 = `<?xml version="1.0"?>
<wms:WMS_Capabilities xmlns:wms="http://www.opengis.net/wms" version="1.3.0">
  <wms:Service>
    <wms:Title>Natura2000Sites</wms:Title>
    <wms:Abstract>Protected sites &amp; habitats</wms:Abstract>
    <wms:AccessConstraints>None</wms:AccessConstraints>
  </wms:Service>
  <wms:Capability>
    <wms:Request>
      <wms:GetMap>
        <wms:Format>image/jpeg</wms:Format>
        <wms:Format>image/png</wms:Format>
        <wms:DCPType><wms:HTTP><wms:Get>
          <wms:OnlineResource xlink:href="https://tiles.example.org/render"/>
        </wms:Get></wms:HTTP></wms:DCPType>
      </wms:GetMap>
      <wms:GetFeatureInfo><wms:Format>text/html</wms:Format></wms:GetFeatureInfo>
    </wms:Request>
    <wms:Layer>
      <wms:Title>Protected sites</wms:Title>
      <wms:CRS>EPSG:4326</wms:CRS>
      <wms:CRS>EPSG:3857</wms:CRS>
      <wms:Attribution>
        <wms:Title>EEA</wms:Title>
        <wms:OnlineResource xlink:href="https://www.eea.europa.eu/"/>
      </wms:Attribution>
      <wms:Layer queryable="1">
        <wms:Name>1</wms:Name>
        <wms:Title>Birds directive</wms:Title>
        <wms:EX_GeographicBoundingBox>
          <wms:westBoundLongitude>-31.3</wms:westBoundLongitude>
          <wms:southBoundLatitude>27.6</wms:southBoundLatitude>
          <wms:eastBoundLongitude>44.8</wms:eastBoundLongitude>
          <wms:northBoundLatitude>71.2</wms:northBoundLatitude>
        </wms:EX_GeographicBoundingBox>
        <wms:Style><wms:LegendURL>
          <wms:OnlineResource xlink:href="https://tiles.example.org/legend?layer=1"/>
        </wms:LegendURL></wms:Style>
      </wms:Layer>
      <wms:Layer>
        <wms:Name>2</wms:Name>
        <wms:Title>Habitats directive</wms:Title>
      </wms:Layer>
    </wms:Layer>
  </wms:Capability>
</wms:WMS_Capabilities>`;

const CAPABILITIES_111 = `<WMT_MS_Capabilities version="1.1.1">
  <Service><Title>Cadastre</Title><AccessConstraints>Fee applies</AccessConstraints></Service>
  <Capability>
    <Request><GetMap><Format>image/png</Format></GetMap></Request>
    <Layer>
      <Name>parcels</Name>
      <Title>Parcels</Title>
      <SRS>EPSG:4326 EPSG:3857</SRS>
      <LatLonBoundingBox minx="12.0" miny="48.5" maxx="18.9" maxy="51.1"/>
    </Layer>
  </Capability>
</WMT_MS_Capabilities>`;

function io(body: string): AdapterIo {
  return {
    async text() {
      return body;
    },
    async json() {
      throw new Error("not used");
    }
  };
}

test("parses a 1.3.0 document, keeping the group out of the drawable set", () => {
  const capabilities = parseWmsCapabilities(CAPABILITIES_130);
  assert.equal(capabilities.version, "1.3.0");
  assert.equal(capabilities.title, "Natura2000Sites");
  assert.equal(capabilities.abstract, "Protected sites & habitats");
  assert.equal(capabilities.getMapUrl, "https://tiles.example.org/render");
  assert.deepEqual(capabilities.formats, ["image/jpeg", "image/png"]);
  assert.equal(capabilities.attributionLabel, "EEA");
  assert.equal(capabilities.attributionUrl, "https://www.eea.europa.eu/");
  // "None" means no constraints, so it must not be shown to the user as one.
  assert.equal(capabilities.accessConstraints, undefined);

  const flat = flattenWmsLayers(capabilities.layers);
  assert.deepEqual(
    flat.map((layer) => [layer.id, layer.selectable]),
    [
      ["group:Protected sites", false],
      ["1", true],
      ["2", true]
    ]
  );
  // CRS is declared once on the group and inherited, which is how every real service writes it.
  assert.deepEqual(flat[2]?.crs, ["EPSG:4326", "EPSG:3857"]);
  assert.deepEqual(flat[1]?.bbox, [-31.3, 27.6, 44.8, 71.2]);
  assert.equal(flat[1]?.legendUrl, "https://tiles.example.org/legend?layer=1");
  assert.equal(flat[1]?.queryable, true);
});

test("reads 1.1.1 spellings — SRS and LatLonBoundingBox", () => {
  const capabilities = parseWmsCapabilities(CAPABILITIES_111);
  assert.equal(capabilities.version, "1.1.1");
  const [layer] = flattenWmsLayers(capabilities.layers);
  assert.deepEqual(layer?.crs, ["EPSG:4326", "EPSG:3857"]);
  assert.deepEqual(layer?.bbox, [12, 48.5, 18.9, 51.1]);
  // A charge is the kind of surprise worth surfacing before the layer is added.
  assert.equal(capabilities.accessConstraints, "Fee applies");
});

test("detects WMS from the query, the path, and neither", () => {
  assert.equal(wmsAdapter.detect(new URL("https://x.org/geoserver/ows?service=WMS")), 0.9);
  assert.equal(wmsAdapter.detect(new URL("https://x.org/a/MapServer/WMSServer")), 0.8);
  assert.equal(wmsAdapter.detect(new URL("https://x.org/geoserver/wms")), 0.8);
  // A sibling OGC service on the same endpoint is not ours to claim.
  assert.equal(wmsAdapter.detect(new URL("https://x.org/geoserver/wms?service=WFS")), 0);
  assert.equal(wmsAdapter.detect(new URL("https://x.org/tiles/1/2/3.png")), 0);
});

test("probe follows the advertised GetMap URL rather than the pasted one", async () => {
  const probe = await wmsAdapter.probe(
    new URL("https://x.org/svc?service=WMS&request=GetCapabilities"),
    io(CAPABILITIES_130)
  );
  assert.equal(probe.endpoint, "https://tiles.example.org/render");
  assert.equal(probe.delivery, "tiles");
  assert.deepEqual(probe.attribution, [{ label: "EEA", url: "https://www.eea.europa.eu/" }]);
});

test("probe rejects a response that is not capabilities", async () => {
  await assert.rejects(
    wmsAdapter.probe(new URL("https://x.org/svc"), io("<html><body>404</body></html>")),
    SourceProbeError
  );
});

test("describe builds a tileable GetMap and a manifest that validates", async () => {
  const probe = await wmsAdapter.probe(new URL("https://x.org/svc"), io(CAPABILITIES_130));
  const manifest = wmsAdapter.describe({
    probe,
    layerId: "natura",
    sublayerIds: ["2", "1"],
    name: "Chráněná území",
    category: "environment"
  });

  assert.equal(manifest.source.type, "raster-tiles");
  const template = (manifest.source.type === "raster-tiles" && manifest.source.tileTemplate) || "";
  const query = new URLSearchParams(template.slice(template.indexOf("?") + 1));
  assert.equal(query.get("request"), "GetMap");
  assert.equal(query.get("layers"), "2,1");
  assert.equal(query.get("crs"), "EPSG:3857");
  assert.equal(query.get("srs"), null);
  assert.equal(query.get("transparent"), "true");
  // PNG over the JPEG the service lists first: an opaque overlay hides the map beneath it.
  assert.equal(query.get("format"), "image/png");
  // Left unencoded, or MapLibre never substitutes the extent.
  assert.ok(template.endsWith("&bbox={bbox-epsg-3857}"));

  assert.equal(manifest.legend?.type, "image");
  assert.deepEqual(
    manifest.legend?.items?.map((item) => item.label),
    ["Birds directive"]
  );
  assert.equal(validateLayerManifestV2(manifest).valid, true);
});

test("one temporal WMS layer declares a validated filter and explicit GetMap default", async () => {
  const xml = CAPABILITIES_130.replace(
    "<wms:Name>1</wms:Name>",
    `<wms:Name>1</wms:Name>
    <wms:Dimension name="time" units="ISO8601" default="2026-09-01">2026-09-01,2026-09-02</wms:Dimension>`
  );
  const probe = await wmsAdapter.probe(new URL("https://x.org/svc?time=old"), io(xml));
  const manifest = wmsAdapter.describe({ probe, layerId: "dated-wms", sublayerIds: ["1"] });
  assert.equal(new URL(manifest.source.tileTemplate!).searchParams.get("time"), "2026-09-01");
  assert.equal(manifest.filters?.[0]?.default, "2026-09-01");
  assert.equal(manifest.filters?.[0]?.options?.length, 2);
  assert.equal(validateLayerManifestV2(manifest).valid, true);
  const mixed = wmsAdapter.describe({ probe, layerId: "mixed-wms", sublayerIds: ["1", "2"] });
  assert.equal(mixed.filters, undefined);
});

test("describe uses 1.1.1's srs parameter", async () => {
  const probe = await wmsAdapter.probe(new URL("https://x.org/svc"), io(CAPABILITIES_111));
  const template = wmsAdapter.tileTemplate!({
    probe,
    layerId: "parcels",
    sublayerIds: []
  });
  const query = new URLSearchParams(template.slice(template.indexOf("?") + 1));
  assert.equal(query.get("srs"), "EPSG:3857");
  assert.equal(query.get("crs"), null);
  // No chosen sublayer and one drawable layer: picking it beats making the user pick it.
  assert.equal(query.get("layers"), "parcels");
});

test("a service without Web Mercator is refused instead of drawn skewed", async () => {
  const probe = await wmsAdapter.probe(
    new URL("https://x.org/svc"),
    io(CAPABILITIES_111.replace("EPSG:4326 EPSG:3857", "EPSG:5514"))
  );
  assert.throws(
    () => wmsAdapter.tileTemplate!({ probe, layerId: "x", sublayerIds: [] }),
    /Web Mercator/
  );
});

test("the registry routes a WMS URL to this adapter", async () => {
  const registry = createAdapterRegistry([wmsAdapter]);
  const probe = await registry.probe(
    "https://x.org/geoserver/wms?service=WMS&request=GetCapabilities",
    io(CAPABILITIES_130)
  );
  assert.equal(probe.adapterId, "wms");
});
