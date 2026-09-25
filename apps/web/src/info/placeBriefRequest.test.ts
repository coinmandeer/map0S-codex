import assert from "node:assert/strict";
import test from "node:test";
import type { GeoFeature, Place } from "@mapos/layer-sdk";
import { locationBriefRequest, pinBriefRequest } from "./placeBriefRequest";

const place: Place = {
  id: "osm:1",
  name: "Café Sever",
  category: "cafe",
  lng: 14.4212,
  lat: 50.0871,
  sources: [],
  tags: []
} as unknown as Place;

function feature(properties: Record<string, unknown>): GeoFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [place.lng, place.lat] },
    properties
  } as GeoFeature;
}

test("a location click sends only the location", () => {
  const request = locationBriefRequest(place);
  assert.equal(request.enabled, true);
  assert.equal(request.query.layerId, undefined);
  assert.equal(request.query.facts, undefined);
});

test("a pin click sends the pin's own fields, so neighbours cannot answer for it", () => {
  const request = pinBriefRequest({
    place,
    layerId: "osm-poi",
    feature: feature({ id: "osm:1", opening_hours: "Mo-Fr 08:00-18:00", cuisine: "coffee" })
  });

  assert.equal(request.query.layerId, "osm-poi");
  assert.match(request.query.facts ?? "", /opening_hours=Mo-Fr 08:00-18:00/u);
  assert.match(request.query.facts ?? "", /cuisine=coffee/u);
  // A named pin is worth looking up on the web; the summary cites what comes back.
  assert.equal(request.query.web, "1");
});

test("the wire format's separators are stripped rather than escaped", () => {
  const request = pinBriefRequest({
    place,
    layerId: "osm-poi",
    feature: feature({ id: "osm:1", operator: "A|B=C" })
  });

  const facts = request.query.facts ?? "";
  assert.equal(facts.split("|").length, 1);
  assert.equal(facts.split("=").length, 2);
});

test("a pin with no fields still asks about its layer", () => {
  const request = pinBriefRequest({
    place,
    layerId: "osm-poi",
    feature: feature({ id: "osm:1" })
  });

  assert.equal(request.enabled, true);
  assert.equal(request.query.facts, undefined);
  assert.equal(request.query.layerId, "osm-poi");
});
