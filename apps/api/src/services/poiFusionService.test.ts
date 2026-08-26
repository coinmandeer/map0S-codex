import assert from "node:assert/strict";
import { test } from "node:test";
import type { Place, PlaceSourceId } from "@mapos/layer-sdk";
import { __testing } from "./poiFusionService.js";

const { dedupe, namesMatch } = __testing;

function place(
  source: PlaceSourceId,
  name: string,
  lng: number,
  lat: number,
  extra: Partial<Place> = {}
): Place {
  return {
    id: `${source}:${name}`,
    name,
    lng,
    lat,
    category: "castle",
    sources: [
      { source, sourceRef: name, confidence: source === "mapy" ? 0.8 : 0.75, refreshedAt: "" }
    ],
    ...extra
  };
}

test("names match when one contains the other", () => {
  assert.ok(namesMatch("Hrad Okoř", "Okoř"));
  assert.ok(namesMatch("Zámek Dobříš", "zamek dobris"));
  assert.equal(namesMatch("Okoř", "Karlštejn"), false);
  // Too short to be meaningful containment — "U Tří" appears in half the pubs in Bohemia.
  assert.equal(namesMatch("U T", "U Tří lip"), false);
});

test("nearby places with matching names merge and keep both provenances", () => {
  const { merged, dropped } = dedupe([
    place("mapy", "Hrad Okoř", 14.2601, 50.1712),
    place("osm", "Okoř", 14.2604, 50.1714)
  ]);

  assert.equal(merged.length, 1);
  assert.equal(dropped, 1);
  assert.deepEqual(
    merged[0]!.sources.map((s) => s.source),
    ["mapy", "osm"]
  );
});

test("same name far apart stays separate", () => {
  const { merged } = dedupe([
    place("osm", "Kostel svatého Jana", 14.26, 50.17),
    place("osm", "Kostel svatého Jana", 14.4, 50.09)
  ]);
  assert.equal(merged.length, 2);
});

test("different names at the same spot stay separate", () => {
  const { merged } = dedupe([
    place("osm", "Restaurace U Lípy", 14.26, 50.17),
    place("osm", "Lékárna Na Rohu", 14.2601, 50.1701)
  ]);
  assert.equal(merged.length, 2);
});

test("a shared wikidata id merges regardless of name or distance heuristics", () => {
  const { merged } = dedupe([
    place("wikidata", "Prague Castle", 14.4009, 50.0899, { wikidata: "Q193369" }),
    place("osm", "Pražský hrad", 14.4012, 50.0901, { wikidata: "Q193369" })
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.wikidata, "Q193369");
});

test("merging fills gaps without overwriting a more confident claim", () => {
  const high = place("mapy", "Hrad Okoř", 14.2601, 50.1712);
  const low = place("osm", "Okoř", 14.2604, 50.1714, {
    website: "https://okor.cz",
    tags: ["hrad"]
  });
  const { merged } = dedupe([high, low]);

  assert.equal(merged[0]!.name, "Hrad Okoř");
  assert.equal(merged[0]!.website, "https://okor.cz");
  assert.deepEqual(merged[0]!.tags, ["hrad"]);
});
