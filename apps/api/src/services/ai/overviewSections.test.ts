import test from "node:test";
import assert from "node:assert/strict";
import type { EvidenceItem } from "@mapos/layer-sdk";
import {
  overviewSections,
  validatedSynthesis,
  restoreSynthesisEvidenceIds,
  mergeSynthesisSections
} from "./overviewSections.js";
import { diverseHighlights, overviewUnit } from "./overviewFormatting.js";
const e = (
  id: string,
  text: string,
  topic = "statistics",
  relation: EvidenceItem["relation"] = "same_entity"
): EvidenceItem => ({
  id,
  text,
  topic,
  relation,
  label: id,
  sourceRecordId: id,
  providerId: "test",
  kind: "fact",
  access: "public",
  originGroup: "test",
  retrievedAt: "2026-09-12T00:00:00Z"
});
test("local measurement and wider context appear in separate stable sections", () => {
  const sources = [
    e("local", "Populace: 100 (2024)."),
    e("parent", "AROPE: 12 % (2025), širší region.", "statistics", "part_of")
  ];
  const sections = overviewSections(sources);
  assert.deepEqual(
    sections.map((s) => s.id),
    ["statistics", "context"]
  );
  assert.equal(sections[0]?.claims[0]?.evidenceIds[0], "local");
});
test("model cannot change value, drop year/scope/negation, promote a web candidate, or mislabel a neighbour", () => {
  const fact = e("one", "AROPE: 12 % (2025). Údaj za širší region.", "statistics", "part_of");
  const output = (quote: string, id = "summary") => ({
    sections: [{ id, claims: [{ evidenceId: "one", quote }] }]
  });
  assert.equal(validatedSynthesis(output(fact.text), [fact])[0]?.claims[0]?.text, fact.text);
  for (const quote of [
    "AROPE: 99 % (2025). Údaj za širší region.",
    "AROPE: 12 % (2025).",
    "AROPE: 12 % (2024). Údaj za širší region."
  ])
    assert.throws(() => validatedSynthesis(output(quote), [fact]));
  assert.throws(() => validatedSynthesis(output(fact.text, "character"), [fact]));
  assert.throws(() => validatedSynthesis(output(fact.text), [{ ...fact, kind: "document" }]));
  const prose = e("one", "Vstup není bezbariérový. Park leží u řeky.", "character");
  assert.doesNotThrow(() => validatedSynthesis(output("Vstup není bezbariérový."), [prose]));
  assert.throws(() => validatedSynthesis(output("Vstup je bezbariérový."), [prose]));
});
test("brief highlight diversity preserves all source identities and renders readable units", () => {
  const items = [
    { id: "a", title: "Mas", category: "ruins" },
    { id: "b", title: "Mas", category: "ruins" },
    { id: "c", title: "Museum", category: "museum" }
  ];
  assert.deepEqual(
    diverseHighlights(items, 2).map((p) => p.id),
    ["a", "c"]
  );
  assert.equal(items.length, 3);
  assert.equal(overviewUnit("people"), "obyvatel");
  assert.equal(overviewUnit("unknown"), "unknown");
});

test("short area intro preserves source facts without repeating them below", () => {
  const name = e("area:test:name", "Praha · obec · CZ.", "identity");
  const prose = e("description", "Praha leží na Vltavě. Ve městě sídlí parlament.", "character");
  const local = e("population", "Populace: 100 (2024). Vybraná oblast Praha.");
  const context = e("parent", "AROPE: 12 % (2025). Širší region.", "statistics", "part_of");
  const sections = overviewSections([name, prose, local, context]);
  assert.equal(
    sections[0]?.claims.find((c) => c.evidenceIds[0] === "description")?.text,
    "Praha leží na Vltavě."
  );
  assert.equal(
    sections.find((s) => s.id === "character")?.claims[0]?.text,
    "Ve městě sídlí parlament."
  );
  assert.equal(sections.flatMap((s) => s.claims).filter((c) => c.text === local.text).length, 1);
  assert.equal(sections.find((s) => s.id === "context")?.claims[0]?.text, context.text);
  assert.equal(sections.flatMap((s) => s.claims).filter((c) => c.text === name.text).length, 1);
});

test("short model handles restore canonical citations and reject foreign run references", () => {
  const evidence = e("long-canonical-id", "Populace: 100 (2024).");
  const aliases = new Map([["e1", evidence.id]]);
  const input = { sections: [{ id: "summary", claims: [{ evidenceId: "e1" }] }] };
  const restored = restoreSynthesisEvidenceIds(input, aliases, [evidence]);
  assert.equal(validatedSynthesis(restored, [evidence])[0]?.claims[0]?.evidenceIds[0], evidence.id);
  assert.throws(() =>
    restoreSynthesisEvidenceIds(input, new Map([["e2", "another-run"]]), [evidence])
  );
  assert.throws(() =>
    validatedSynthesis(
      restoreSynthesisEvidenceIds(
        {
          ...input,
          sections: [{ id: "summary", claims: [{ evidenceId: "e1", quote: "Populace: 999." }] }]
        },
        aliases,
        [evidence]
      ),
      [evidence]
    )
  );
});

test("model lead removes only exact duplicate claims from the same source", () => {
  const claim = {
    id: "a",
    text: "Název: Park",
    evidenceIds: ["source-a"],
    support: "source-statement" as const
  };
  const other = { ...claim, id: "b", evidenceIds: ["source-b"] };
  const result = mergeSynthesisSections(
    [{ id: "summary", title: "Přehled", claims: [claim] }],
    [{ id: "facts", title: "Fakta", claims: [claim, other] }]
  );
  assert.equal(result[1]?.claims.length, 1);
  assert.deepEqual(result[1]?.claims[0]?.evidenceIds, ["source-b"]);
});
