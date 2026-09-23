import type { EvidenceItem, OverviewResult } from "@mapos/layer-sdk";

import { overviewCategory } from "./overviewFormatting.js";
/** A first readable paragraph without model calls. Only exact-entity source fields participate;
 * nearby businesses, web snippets and visitor reports can never become the target identity. */
export function deterministicOverviewIntro(
  evidence: readonly EvidenceItem[]
): OverviewResult["sections"][number] | null {
  const field = (name: string) =>
    evidence.find(
      (item) =>
        item.kind === "fact" && item.relation === "same_entity" && item.id.endsWith(`:${name}`)
    );
  const name = field("name"),
    category = field("category"),
    address = field("address");
  if (!name) return null;
  if (name.id.startsWith("area:")) {
    const facts = evidence.filter((item) => item.kind === "fact");
    const local = facts
      .filter((item) => item.topic === "statistics" && item.relation === "same_entity")
      .slice(0, 2);
    const character = facts.find(
      (item) => item.topic === "character" && item.relation === "same_entity"
    );
    const context = facts.find(
      (item) => item.topic === "statistics" && item.relation === "part_of"
    );
    const highlights = facts
      .filter((item) => item.topic === "highlights" && item.relation === "within_area")
      .slice(0, 2);
    const useful = character
      ? [character, ...local.slice(0, 1)]
      : [...local, ...highlights, ...(context ? [context] : [])].slice(0, 3);
    return {
      id: "summary",
      title: "Stručný přehled oblasti",
      claims: [
        {
          id: "intro:identity",
          text: name.text,
          evidenceIds: [name.id],
          support: "source-statement"
        },
        ...useful.map((item) => ({
          id: `intro:${item.id}`,
          text: item.topic === "character" ? shortCharacter(item.text) : item.text,
          evidenceIds: [item.id],
          support: "source-statement" as const
        }))
      ]
    };
  }
  const value = (item: EvidenceItem) => item.text.replace(/^[^:]+:\s*/, "").trim();
  const provider =
    name.providerId === "osm"
      ? "OpenStreetMap"
      : name.providerId === "wikidata"
        ? "Wikidata"
        : "zdroje místa";
  const ids = [name.id];
  let text = `Přehled místa ${value(name)} vychází ze záznamu ${provider}.`;
  if (
    category &&
    category.providerId === name.providerId &&
    category.sourceRecordId === name.sourceRecordId
  ) {
    const raw = value(category);
    text += ` Zdroj jej řadí do kategorie ${overviewCategory(raw)}.`;
    ids.push(category.id);
  }
  if (
    address &&
    address.providerId === name.providerId &&
    address.sourceRecordId === name.sourceRecordId
  ) {
    text += ` Uvedená adresa je ${value(address)}.`;
    ids.push(address.id);
  }
  return {
    id: "summary",
    title: "Stručný přehled",
    claims: [{ id: "intro:identity", text, evidenceIds: ids, support: "source-statement" }]
  };
}

/** Whole opening sentences keep the first view short; the full cited article stays below. */
export function shortCharacter(text: string): string {
  const sentences = [...new Intl.Segmenter("cs", { granularity: "sentence" }).segment(text)].map(
    (s) => s.segment.trim()
  );
  return sentences[0] || text;
}
