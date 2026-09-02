import assert from "node:assert/strict";
import test from "node:test";
import { buildBriefCitations, type BriefNeighbour } from "./briefService.js";

test("brief citations reflect the actual neighbour and article sources without duplicates", () => {
  const neighbours: BriefNeighbour[] = [
    {
      name: "Hrad",
      category: "castle",
      categoryLabel: "Hrad",
      distanceM: 80,
      sources: ["osm", "wikidata"]
    },
    {
      name: "Parkoviště",
      category: "parking",
      categoryLabel: "Parkoviště",
      distanceM: 120,
      sources: ["osm"]
    }
  ];
  const citations = buildBriefCitations(neighbours, {
    lang: "cs",
    title: "Hrad",
    url: "https://cs.wikipedia.org/wiki/Hrad"
  });
  assert.deepEqual(
    citations.map((citation) => citation.sourceId),
    ["osm", "wikidata", "wikipedia:cs:Hrad"]
  );
  assert.ok(citations.every((citation) => citation.label && citation.url));
});
