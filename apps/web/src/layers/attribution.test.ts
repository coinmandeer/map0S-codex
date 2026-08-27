import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { registerLayer, resetLayerRegistry } from "./registry";
import { activeAttribution, allAttribution } from "./attribution";

function layer(id: string, attribution: { label: string; url?: string; license?: string }[]) {
  registerLayer({
    kind: "pins",
    manifest: { id, name: id, icon: "•", color: "#000", description: id, category: "community" },
    create: () => ({ setVisible: () => {}, setOpacity: () => {}, destroy: () => {} }) as never,
    attribution
  });
}

beforeEach(() => {
  resetLayerRegistry();
});

test("only what is on screen is credited", () => {
  layer("earthquakes", [{ label: "USGS" }]);
  layer("mapillary", [{ label: "Mapillary" }]);

  const credits = activeAttribution(
    { earthquakes: { visible: true }, mapillary: { visible: false } },
    {}
  );

  assert.deepEqual(
    credits.map((c) => c.label),
    ["USGS"]
  );
});

test("enabled place sources are credited alongside layers", () => {
  layer("earthquakes", [{ label: "USGS" }]);

  const credits = activeAttribution({ earthquakes: { visible: true } }, { osm: true, mapy: false });

  const labels = credits.map((c) => c.label);
  assert.ok(labels.includes("USGS"));
  assert.ok(labels.some((l) => l.includes("OpenStreetMap")));
  assert.ok(!labels.some((l) => l.includes("Seznam")));
});

test("a source used by two layers is named once, keeping the fuller entry", () => {
  layer("a", [{ label: "OpenStreetMap", url: "https://osm.org", license: "ODbL-1.0" }]);
  layer("b", [{ label: "OpenStreetMap" }]);

  const credits = activeAttribution({ a: { visible: true }, b: { visible: true } }, {});

  assert.equal(credits.length, 1);
  assert.equal(credits[0]?.license, "ODbL-1.0");
});

test("the About list names what uses each source, on or off", () => {
  layer("mapillary", [{ label: "Mapillary", license: "CC-BY-SA-4.0" }]);

  const entries = allAttribution();
  const mapillary = entries.find((e) => e.label === "Mapillary");

  assert.equal(mapillary?.usedBy, "mapillary");
  // Basemap and place sources are in the list even though no layer declared them.
  assert.ok(entries.some((e) => e.usedBy === "Podkladová mapa"));
  assert.ok(entries.some((e) => e.usedBy === "Wikidata"));
});
