import assert from "node:assert/strict";
import { test } from "node:test";
import type { Bbox } from "@mapos/layer-sdk";
import { rankByNotability, scoreOf, type NotabilityCandidate } from "./notabilityService.js";

const BBOX: Bbox = [14.3, 50.0, 14.5, 50.15];

const CASTLE: NotabilityCandidate = {
  id: "osm-1",
  name: "Pražský hrad",
  category: "castle",
  lng: 14.4,
  lat: 50.09,
  wikidataId: "Q193369",
  wikipediaTitle: "Pražský hrad"
};

const CHAPEL: NotabilityCandidate = {
  id: "osm-2",
  name: "Kaple sv. Kříže",
  category: "monument",
  lng: 14.41,
  lat: 50.08,
  wikidataId: "Q999999"
};

const UNKNOWN: NotabilityCandidate = {
  id: "osm-3",
  name: "Vyhlídka U dubu",
  category: "viewpoint",
  lng: 14.42,
  lat: 50.07
};

const silent = {
  async nearbyArticles() {
    return [];
  },
  async sitelinks() {
    return new Map<string, number>();
  },
  async rates() {
    return [];
  },
  async pageviews() {
    return undefined;
  }
};

test("places with signals outrank places without", async () => {
  const ranked = await rankByNotability([UNKNOWN, CHAPEL, CASTLE], {
    bbox: BBOX,
    signals: {
      ...silent,
      async sitelinks() {
        return new Map([
          ["Q193369", 60],
          ["Q999999", 2]
        ]);
      },
      async pageviews(title) {
        return title === "Pražský hrad" ? 240_000 : 30;
      }
    }
  });

  assert.deepEqual(
    ranked.map((p) => p.id),
    ["osm-1", "osm-2", "osm-3"]
  );
  assert.equal(ranked[0]!.signals.sitelinks, 60);
  assert.equal(ranked[0]!.signals.pageviews, 240_000);
  // The unranked place is still listed — the old behaviour is the fallback, not the rule.
  assert.equal(ranked[2]!.score, 0);
});

test("a Wikipedia article nobody mapped joins the list", async () => {
  const ranked = await rankByNotability([UNKNOWN], {
    bbox: BBOX,
    signals: {
      ...silent,
      async nearbyArticles() {
        return [{ pageid: 42, title: "Karlův most", lat: 50.086, lon: 14.411 }];
      },
      async pageviews() {
        return 100_000;
      }
    }
  });

  const bridge = ranked.find((p) => p.name === "Karlův most");
  assert.ok(bridge, "an article with no OSM row is still a place worth seeing");
  assert.equal(bridge.category, "wikipedia");
  assert.equal(ranked[0]!.name, "Karlův most");
});

test("an article about a place we already have annotates it instead of duplicating it", async () => {
  const ranked = await rankByNotability([{ ...CASTLE, wikipediaTitle: undefined }], {
    bbox: BBOX,
    signals: {
      ...silent,
      async nearbyArticles() {
        return [{ pageid: 7, title: "Pražský hrad", lat: 50.09, lon: 14.4 }];
      }
    }
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]!.id, "osm-1");
  assert.equal(ranked[0]!.wikipediaTitle, "Pražský hrad");
});

test("an OpenTripMap rating counts even without a key for the other signals", async () => {
  const ranked = await rankByNotability([UNKNOWN, CHAPEL], {
    bbox: BBOX,
    signals: {
      ...silent,
      async rates() {
        return [{ xid: "X1", name: "Vyhlídka", rate: 7, point: { lon: 14.42, lat: 50.07 } }];
      }
    }
  });

  assert.equal(ranked[0]!.id, "osm-3");
  assert.equal(ranked[0]!.signals.rate, 7);
});

test("pageviews are damped so one landmark doesn't flatten the rest", () => {
  const huge = scoreOf({ pageviews: 1_000_000 });
  const large = scoreOf({ pageviews: 100_000 });
  const small = scoreOf({ pageviews: 1_000 });

  assert.ok(huge > large && large > small);
  // A hundredfold difference in traffic must not be a hundredfold difference in score.
  assert.ok(huge / small < 3);
});
