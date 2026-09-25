import type { EvidenceItem } from "@mapos/layer-sdk";

export function evidenceDocumentKey(source: EvidenceItem) {
  return JSON.stringify([source.providerId, source.sourceRecordId || source.id, source.url]);
}
/** Several fields of one original record need one link; equally named documents remain distinct. */
export function overviewCitationIds(
  ids: readonly string[],
  sources: ReadonlyMap<string, EvidenceItem>
) {
  const seen = new Set<string>();
  return ids.filter((id) => {
    const source = sources.get(id);
    const key = source ? evidenceDocumentKey(source) : id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
