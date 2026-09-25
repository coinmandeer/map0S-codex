import type { EvidenceItem, OverviewResult, OverviewClaim } from "@mapos/layer-sdk";
import { deterministicOverviewIntro } from "./overviewIntro.js";
const groups = [
  ["character", "O místě"],
  ["statistics", "Místní statistiky"],
  ["highlights", "Zajímavá místa"],
  ["practical", "Praktické informace"],
  ["context", "Širší statistický kontext"],
  ["reports", "Návštěvnické zkušenosti"],
  ["facts", "Další doložené informace"],
  ["local-index", "Pokrytí místních dat"]
] as const;
export function evidenceSection(e: EvidenceItem): string {
  if (e.kind === "report") return "reports";
  if (e.topic === "statistics") return e.relation === "same_entity" ? "statistics" : "context";
  if (["character", "highlights", "local-index"].includes(e.topic)) return e.topic;
  if (/:(?:openingHours|address|website|elevationM)$/.test(e.id)) return "practical";
  return "facts";
}
export function overviewSections(evidence: readonly EvidenceItem[]): OverviewResult["sections"] {
  const intro = deterministicOverviewIntro(evidence);
  const sections: OverviewResult["sections"] = intro ? [intro] : [];
  const remainingText = (e: EvidenceItem) => {
    const included = intro?.claims.find(
      (c) => c.evidenceIds.length === 1 && c.evidenceIds[0] === e.id
    );
    if (!included) return e.text;
    if (included.text === e.text) return "";
    if (e.topic === "character" && e.text.startsWith(included.text))
      return e.text.slice(included.text.length).trim();
    return e.text;
  };
  for (const [id, title] of groups) {
    const claims: OverviewClaim[] = evidence
      .filter(
        (e) =>
          e.kind !== "document" &&
          evidenceSection(e) === id &&
          !e.id.endsWith(":wikidata") &&
          remainingText(e)
      )
      .map((e) => ({
        id: `claim:${e.id}`,
        text: remainingText(e),
        evidenceIds: [e.id],
        support: e.kind === "report" ? "visitor-report" : "source-statement",
        ...((e.observedAt ?? e.publishedAt) ? { period: e.observedAt ?? e.publishedAt } : {})
      }));
    if (claims.length) sections.push({ id, title, claims: claims.slice(0, 12) });
  }
  return sections;
}
/** Model submits complete source sentences, not free-form claims that merely attach citations.
 * A changed number, dropped negation/qualifier, entity or time cannot pass this boundary. */
export function validatedSynthesis(
  value: unknown,
  evidence: readonly EvidenceItem[]
): OverviewResult["sections"] {
  const v = value as {
    sections?: { id: string; claims?: { evidenceId: string; quote: unknown }[] }[];
  } | null;
  if (!v || !Array.isArray(v.sections) || !v.sections.length || v.sections.length > 5)
    throw new Error("Neplatná struktura souhrnu.");
  const titles: Record<string, string> = {
    summary: "Stručný přehled",
    character: "Charakter místa",
    practical: "Praktické informace",
    highlights: "Zajímavá místa",
    context: "Širší kontext"
  };
  const seenSections = new Set<string>();
  let words = 0;
  return v.sections.map((section) => {
    if (
      !titles[section.id] ||
      seenSections.has(section.id) ||
      !Array.isArray(section.claims) ||
      !section.claims.length ||
      section.claims.length > 6
    )
      throw new Error("Neplatná sekce souhrnu.");
    seenSections.add(section.id);
    const claims: OverviewClaim[] = section.claims.map((claim, index: number) => {
      const e = evidence.find(
        (e) => e.id === claim.evidenceId && e.kind !== "document" && e.access === "public"
      );
      // Partial extraction is allowed only for linked encyclopedia prose. Structured/statistical
      // evidence must retain its full scope, year and incompleteness qualification.
      const sentences =
        e?.topic === "character" && e.relation === "same_entity" ? sourceSentences(e.text) : [];
      const quote = claim.quote;
      if (
        !e ||
        typeof quote !== "string" ||
        ![e.text, ...(sentences ?? [])].includes(quote) ||
        !quote.trim()
      )
        throw new Error("Tvrzení nepodporuje celý zdrojový údaj.");
      if (section.id === "character" && e.relation !== "same_entity")
        throw new Error("Širší okolí není identita místa.");
      if (section.id === "practical" && evidenceSection(e) !== "practical")
        throw new Error("Neplatná praktická informace.");
      words += quote.split(/\s+/u).length;
      if (words > 240) throw new Error("Souhrn překračuje délku.");
      return {
        id: `synthesis:${section.id}:${e.id}:${index}`,
        text: quote,
        evidenceIds: [e.id],
        support: e.kind === "report" ? "visitor-report" : "source-statement"
      };
    });
    return { id: section.id, title: titles[section.id], claims };
  });
}

/** Model-local handles must resolve within this exact run, before normal claim validation. */
export function sourceSentences(text: string): string[] {
  return [...new Intl.Segmenter("cs", { granularity: "sentence" }).segment(text)]
    .map((item) => item.segment.trim())
    .filter(Boolean);
}
export function restoreSynthesisEvidenceIds(
  value: unknown,
  aliases: ReadonlyMap<string, string>,
  evidence: readonly EvidenceItem[]
): { sections: { id: string; claims: { evidenceId: string; quote: string }[] }[] } {
  const v = value as {
    sections?: { id: string; claims?: { evidenceId: string; sentenceIndex?: number }[] }[];
  } | null;
  if (!Array.isArray(v?.sections) || v.sections.length > 5)
    throw new Error("Neplatná struktura souhrnu.");
  return {
    sections: v.sections.map((section) => {
      if (!Array.isArray(section.claims) || section.claims.length > 6)
        throw new Error("Neplatné odkazy souhrnu.");
      return {
        id: section.id,
        claims: section.claims.map((claim) => {
          if (
            !claim ||
            Object.keys(claim).some((key) => !["evidenceId", "sentenceIndex"].includes(key))
          )
            throw new Error("Model smí vybírat pouze doložené podklady.");
          const id = aliases.get(claim.evidenceId),
            item = evidence.find((e) => e.id === id);
          if (!id || !item || item.access !== "public" || item.kind === "document")
            throw new Error("Neznámý zdroj souhrnu.");
          let quote = item.text;
          if (claim.sentenceIndex !== undefined) {
            if (
              item.topic !== "character" ||
              item.relation !== "same_entity" ||
              !Number.isInteger(claim.sentenceIndex) ||
              claim.sentenceIndex < 0 ||
              claim.sentenceIndex >= 4
            )
              throw new Error("Neplatný výběr věty.");
            quote = sourceSentences(item.text)[claim.sentenceIndex]!;
            if (!quote) throw new Error("Neznámá věta zdroje.");
          }
          return { evidenceId: id, quote };
        })
      };
    })
  };
}

/** Replacing the lead must not repeat the same source fact in the retained details. */
export function mergeSynthesisSections(
  next: OverviewResult["sections"],
  previous: OverviewResult["sections"]
): OverviewResult["sections"] {
  const displayed = next.flatMap((section) => section.claims);
  return [
    ...next,
    ...previous
      .filter((section) => !next.some((s) => s.id === section.id))
      .map((section) => ({
        ...section,
        claims: section.claims.filter(
          (claim) =>
            !displayed.some(
              (other) =>
                other.text === claim.text &&
                other.evidenceIds.some((id) => claim.evidenceIds.includes(id))
            )
        )
      }))
      .filter((section) => section.claims.length)
  ];
}
