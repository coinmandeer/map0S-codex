import assert from "node:assert/strict";
import test from "node:test";
import { gdacsEvents, gdacsFootprints } from "./gdacs.js";
const event = (episodeid: number, longitude = 10) => ({
  geometry: { type: "Point", coordinates: [longitude, 20] },
  properties: {
    eventtype: "TC",
    eventid: 42,
    episodeid,
    name: "Cyclone",
    alertlevel: "Orange",
    severitydata: { severity: 83, severityunit: "km/h" }
  }
});
test("GDACS collapses episodes, preserves severity units and rejects invalid locations", () => {
  const features = gdacsEvents(
    { features: [event(1), event(3), event(2), event(9, 400)] },
    [-180, -90, 180, 90]
  );
  assert.equal(features.length, 1);
  assert.equal(features[0]!.properties.episodeId, 3);
  assert.equal(features[0]!.properties.unit, "km/h");
  assert.equal(features[0]!.properties.severity, 83);
  assert.equal(features[0]!.properties.id, "gdacs:TC:42");
});
test("GDACS footprints retain holes and original meaning but reject wrong episodes and open rings", () => {
  const events = gdacsEvents({ features: [event(3)] }, [-180, -90, 180, 90]);
  const outer = [
    [9, 19],
    [11, 19],
    [11, 21],
    [9, 21],
    [9, 19]
  ];
  const hole = [
    [9.2, 19.2],
    [9.2, 19.4],
    [9.4, 19.4],
    [9.4, 19.2],
    [9.2, 19.2]
  ];
  const properties = {
    ...event(3).properties,
    polygonlabel: "Uncertainty Cones",
    polygondate: "2026-09-24T00:00:00",
    Class: "Poly_Cones"
  };
  const feature = { properties, geometry: { type: "Polygon", coordinates: [outer, hole] } };
  const shapes = gdacsFootprints(
    {
      features: [
        feature,
        { ...feature, properties: { ...properties, episodeid: 2 } },
        { ...feature, geometry: { type: "Polygon", coordinates: [outer.slice(1)] } }
      ]
    },
    events[0]!
  );
  assert.equal(shapes.length, 1);
  assert.deepEqual(shapes[0]!.geometry, feature.geometry);
  assert.equal(shapes[0]!.label, "Uncertainty Cones");
  assert.equal(shapes[0]!.time, "2026-09-24T00:00:00");
});
