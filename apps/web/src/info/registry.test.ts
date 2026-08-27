import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import type { Place } from "@mapos/layer-sdk";
import { infoPanelsFor, registerInfoPanel, resetInfoPanels, allInfoPanels } from "./registry";
import type { InfoPanel } from "./registry";

const noop = (() => null) as InfoPanel["render"];

function place(overrides: Partial<Place> = {}): Place {
  return {
    id: "osm:240",
    name: "Hrad Okoř",
    lng: 14.2,
    lat: 50.1,
    category: "castle",
    sources: [],
    ...overrides
  };
}

function panel(id: string, extra: Partial<InfoPanel> = {}): InfoPanel {
  return {
    id,
    label: id,
    icon: "•",
    kind: "api",
    appliesTo: () => true,
    attribution: "test",
    render: noop,
    ...extra
  };
}

beforeEach(() => resetInfoPanels());

test("a panel is only offered when it has something to show", () => {
  registerInfoPanel(panel("prehled"));
  registerInfoPanel(panel("wikidata", { appliesTo: ({ place: p }) => Boolean(p.wikidata) }));

  assert.deepEqual(
    infoPanelsFor({ place: place(), refs: {} }).map((p) => p.id),
    ["prehled"]
  );
  assert.deepEqual(
    infoPanelsFor({ place: place({ wikidata: "Q42" }), refs: {} }).map((p) => p.id),
    ["prehled", "wikidata"]
  );
});

test("panels can qualify on a source ref the place record itself lacks", () => {
  registerInfoPanel(panel("foursquare", { appliesTo: ({ refs }) => Boolean(refs.fsq) }));

  assert.equal(infoPanelsFor({ place: place(), refs: {} }).length, 0);
  assert.equal(infoPanelsFor({ place: place(), refs: { fsq: "4b0" } }).length, 1);
});

test("tab order is fixed by the panel, not by registration order", () => {
  registerInfoPanel(panel("pocasi", { order: 30 }));
  registerInfoPanel(panel("prehled", { order: 0 }));
  registerInfoPanel(panel("wikipedia", { order: 10 }));

  assert.deepEqual(
    infoPanelsFor({ place: place(), refs: {} }).map((p) => p.id),
    ["prehled", "wikipedia", "pocasi"]
  );
});

test("a panel whose appliesTo throws is skipped rather than breaking the detail", () => {
  registerInfoPanel(
    panel("broken", {
      appliesTo: () => {
        throw new Error("bad panel");
      }
    })
  );
  registerInfoPanel(panel("prehled"));

  assert.deepEqual(
    infoPanelsFor({ place: place(), refs: {} }).map((p) => p.id),
    ["prehled"]
  );
});

test("registering the same id twice is refused", () => {
  registerInfoPanel(panel("prehled"));
  assert.throws(() => registerInfoPanel(panel("prehled")), /already registered/);
});

test("the built-in panels cover a bare place and grow with what it knows", async () => {
  resetInfoPanels();
  await import("./builtins");

  const bare = infoPanelsFor({ place: place(), refs: {} }).map((p) => p.id);
  assert.deepEqual(bare, ["prehled", "wikipedia", "pocasi"]);

  const rich = infoPanelsFor({
    place: place({ wikidata: "Q42", fsqId: "4b0" }),
    refs: {}
  }).map((p) => p.id);
  assert.deepEqual(rich, ["prehled", "wikipedia", "wikidata", "pocasi", "foursquare"]);

  for (const p of allInfoPanels()) {
    assert.ok(p.attribution, `panel ${p.id} must credit its source`);
  }
});
