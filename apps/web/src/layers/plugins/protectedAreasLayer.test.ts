import assert from "node:assert/strict";
import test from "node:test";
import { naturaGetMapUrl } from "./protectedAreasSource";

/**
 * The URL this layer requested before it was moved onto `wmsAdapter` (§C2), character for
 * character. Natura 2000 is the adapter's first consumer, so it is also the check that the
 * adapter's template builder produces a real service's real request — and the offline fixture in
 * `e2e/fixtures/offlineTest.ts` matches on `request=GetMap`, which this keeps true.
 */
const EXPECTED =
  "https://bio.discomap.eea.europa.eu/arcgis/services/ProtectedSites/Natura2000Sites/MapServer/WMSServer" +
  "?service=WMS&version=1.3.0&request=GetMap&layers=2%2C1&styles=&format=image%2Fpng" +
  "&transparent=true&crs=EPSG%3A3857&width=256&height=256&bbox={bbox-epsg-3857}";

test("the adapter rebuilds the GetMap URL this layer used to hand-write", () => {
  assert.equal(naturaGetMapUrl(["2", "1"]), EXPECTED);
});

test("one directive requests one WMS layer", () => {
  assert.ok(naturaGetMapUrl(["1"]).includes("layers=1&"));
});

test("the extent placeholder stays unencoded, or MapLibre never substitutes it", () => {
  assert.ok(naturaGetMapUrl(["2"]).endsWith("&bbox={bbox-epsg-3857}"));
});
