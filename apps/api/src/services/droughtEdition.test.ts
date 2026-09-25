import assert from "node:assert/strict";
import test from "node:test";
import { latestDroughtEdition } from "./droughtEdition.js";
const xml = (times: string) =>
  `<WMT_MS_Capabilities version="1.1.1"><Service><Title>Test</Title></Service><Capability><Request><GetMap><Format>image/png</Format></GetMap></Request><Layer><Title>Root</Title><Layer><Name>cdiad</Name><Title>CDI</Title><SRS>EPSG:3857</SRS><LatLonBoundingBox minx="-32" miny="25" maxx="70" maxy="72"/><Dimension name="time" units="ISO8601"/><Extent name="time">${times}</Extent></Layer></Layer></Capability></WMT_MS_Capabilities>`;
test("CDI uses explicit last edition, not a fabricated aligned ten-day step", () => {
  assert.equal(latestDroughtEdition(xml("2012-01-01/2026-06-11/P10D")).at, "2026-06-11");
  assert.equal(latestDroughtEdition(xml("2026-06-01,2026-06-21,2026-06-11")).at, "2026-06-21");
});
test("missing, moving and invalid-only domains are not silently called current", () => {
  assert.throws(() => latestDroughtEdition(xml("current")));
  assert.throws(() => latestDroughtEdition(xml("2026-02-30")));
});
