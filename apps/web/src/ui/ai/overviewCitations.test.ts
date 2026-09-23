import test from "node:test";
import assert from "node:assert/strict";
import type { EvidenceItem } from "@mapos/layer-sdk";
import { overviewCitationIds } from "./overviewCitations";
test("same record fields share a citation but equally titled separate documents do not", () => {
  const source = {
    id: "name",
    providerId: "osm",
    sourceRecordId: "node:1",
    label: "Stejný název",
    url: "https://www.openstreetmap.org/node/1"
  } as EvidenceItem;
  const items = [
    source,
    { ...source, id: "category" },
    {
      ...source,
      id: "other",
      sourceRecordId: "node:2",
      url: "https://www.openstreetmap.org/node/2"
    }
  ];
  assert.deepEqual(
    overviewCitationIds(
      items.map((item) => item.id),
      new Map(items.map((item) => [item.id, item]))
    ),
    ["name", "other"]
  );
});
