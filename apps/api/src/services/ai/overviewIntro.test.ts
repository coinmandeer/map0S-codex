import test from "node:test";
import assert from "node:assert/strict";
import type { EvidenceItem } from "@mapos/layer-sdk";
import { deterministicOverviewIntro } from "./overviewIntro.js";
function evidence(
  field: string,
  text: string,
  relation: EvidenceItem["relation"] = "same_entity"
): EvidenceItem {
  return {
    id: `record:osm:node:1:${field}`,
    sourceRecordId: "osm:node:1",
    providerId: "osm",
    label: "OSM",
    relation,
    topic: "identity",
    kind: "fact",
    text,
    retrievedAt: "2026-09-09T00:00:00Z",
    access: "public",
    originGroup: "osm"
  };
}
test("first paragraph quotes only canonical facts and cites every contributing field", () => {
  const input = [
    evidence("name", "Název: Mr Champagne"),
    evidence("category", "Kategorie: restaurant"),
    evidence("address", "Adresa: Tarragona")
  ];
  const intro = deterministicOverviewIntro(input)!;
  assert.match(intro.claims[0]!.text, /Mr Champagne.*OpenStreetMap.*restaurace.*Tarragona/);
  assert.deepEqual(
    intro.claims[0]!.evidenceIds,
    input.map((item) => item.id)
  );
  assert.equal(
    deterministicOverviewIntro([evidence("name", "Název: Sousední restaurace", "nearby")]),
    null
  );
  assert.equal(deterministicOverviewIntro([{ ...input[0]!, kind: "document" }]), null);
});
test("area introduction grows from local statistics while clearly preserving wider context", () => {
  const name = { ...evidence("name", "Tarragona · obec · ES."), id: "area:ES_43148:name" };
  const local = {
    ...evidence("population", "Populace: 141 018 (2024). Vybraná oblast: Tarragona."),
    topic: "statistics"
  };
  const regional = {
    ...evidence(
      "poverty",
      "AROPE: 21,3 % (2025). Údaj za širší statistickou oblast: Cataluña.",
      "part_of"
    ),
    topic: "statistics"
  };
  const intro = deterministicOverviewIntro([name, regional, local])!;
  assert.equal(intro.title, "Stručný přehled oblasti");
  assert.equal(intro.claims[1]?.text, local.text);
  assert.equal(intro.claims[2]?.text, regional.text);
  assert.deepEqual(intro.claims[1]?.evidenceIds, [local.id]);
});
