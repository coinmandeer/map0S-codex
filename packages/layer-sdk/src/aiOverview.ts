/** Shared wire contract. Source text is data, never permission or model instructions. */
export type OverviewTarget =
  | { type: "poi"; layerId: string; featureId: string; lng?: number; lat?: number }
  | { type: "coordinate"; lng: number; lat: number }
  | { type: "area"; areaId: string; boundaryRevision: string }
  | { type: "viewport"; bbox: [number, number, number, number] };
export interface MapAnswerScope {
  target: OverviewTarget;
  language: string;
  intent: string;
  worldId: string;
  layers: { layerId: string; filters: Record<string, unknown> }[];
  requestedTime?: string;
  planRevision?: number;
  fingerprint: string;
}
export interface EvidenceItem {
  id: string;
  sourceRecordId: string;
  providerId: string;
  label: string;
  url?: string;
  relation: "same_entity" | "part_of" | "nearby" | "within_area";
  topic: string;
  kind: "fact" | "report" | "document";
  text: string;
  retrievedAt: string;
  publishedAt?: string;
  observedAt?: string;
  /** Provider-declared validity only; application cache expiry is separate. */
  validUntil?: string;
  cacheUntil?: string;
  /** Server-resolved local reference; never produced by the language model. */
  place?: { layerId: string; featureId: string; title: string; lng: number; lat: number };
  /** Measurement period is explicit, separate from when HTTP fetched the record. */
  statistic?: {
    datasetId: string;
    geoCode: string;
    geoLevel: string;
    period: string;
    value: number;
    unit: string;
  };
  originGroup: string;
  access: "public" | "account-private";
}
export interface OverviewClaim {
  id: string;
  text: string;
  evidenceIds: string[];
  support: "source-statement" | "visitor-report";
  period?: string;
  limitation?: string;
}
export type OverviewStatus =
  "loading" | "complete" | "partial" | "insufficient_evidence" | "cancelled" | "error";
export interface OverviewResult {
  targetKey: string;
  scopeFingerprint: string;
  revision: number;
  geometryRevision: string;
  composition?: "facts" | "model-assisted";
  status: OverviewStatus;
  sections: { id: string; title: string; claims: OverviewClaim[] }[];
  sources: EvidenceItem[];
  mapRefs: {
    layerId: string;
    featureId: string;
    title: string;
    lng: number;
    lat: number;
    evidenceIds: string[];
  }[];
  limitations: string[];
}
export interface OverviewEvent {
  type:
    | "context_ready"
    | "phase"
    | "sources_ready"
    | "section_upsert"
    | Exclude<OverviewStatus, "loading">;
  requestId: string;
  runId: string;
  targetKey: string;
  scopeFingerprint: string;
  seq: number;
  revision: number;
  phase?: string;
  /** Each event is self-contained, so reconnect/late subscribers never combine different revisions. */
  snapshot: OverviewResult;
}
export interface OverviewRequest {
  target: OverviewTarget;
  language?: string;
  intent?: string;
  worldId?: string;
  web?: boolean;
  refresh?: boolean;
  /**
   * Public fields of the clicked pin as `label=value|label=value`. They are explicitly untrusted
   * data — the server sanitizes, caps and labels them as an evidence item and never lets them
   * choose a provider or source. They exist so one named pin no longer answers with the same
   * paragraph as any other pin two hundred metres away.
   */
  facts?: string;
  consent: { externalModel: boolean };
}
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
/** Runtime validation shared by SSE consumers and persisted snapshot readers. */
export function isOverviewResult(value: unknown): value is OverviewResult {
  if (
    !object(value) ||
    typeof value.targetKey !== "string" ||
    typeof value.scopeFingerprint !== "string" ||
    !Number.isSafeInteger(value.revision) ||
    typeof value.geometryRevision !== "string" ||
    !["loading", "complete", "partial", "insufficient_evidence", "cancelled", "error"].includes(
      String(value.status)
    ) ||
    !Array.isArray(value.sources) ||
    value.sources.length > 40 ||
    !Array.isArray(value.sections) ||
    value.sections.length > 12 ||
    !Array.isArray(value.mapRefs) ||
    value.mapRefs.length > 100 ||
    !Array.isArray(value.limitations) ||
    value.limitations.some((v) => typeof v !== "string")
  )
    return false;
  const ids = new Set<string>();
  for (const source of value.sources) {
    if (
      !object(source) ||
      typeof source.id !== "string" ||
      ids.has(source.id) ||
      typeof source.text !== "string" ||
      source.text.length > 6000 ||
      typeof source.label !== "string" ||
      typeof source.retrievedAt !== "string" ||
      !Number.isFinite(Date.parse(source.retrievedAt)) ||
      !["same_entity", "part_of", "nearby", "within_area"].includes(String(source.relation)) ||
      !["public", "account-private"].includes(String(source.access)) ||
      (source.url !== undefined &&
        (typeof source.url !== "string" || !/^https?:\/\//.test(source.url)))
    )
      return false;
    if (
      typeof source.sourceRecordId !== "string" ||
      typeof source.providerId !== "string" ||
      typeof source.topic !== "string" ||
      !["fact", "report", "document"].includes(String(source.kind)) ||
      typeof source.originGroup !== "string"
    )
      return false;
    if (source.place !== undefined) {
      const p = source.place;
      if (
        !object(p) ||
        typeof p.layerId !== "string" ||
        p.layerId.startsWith("ai-answer-") ||
        typeof p.featureId !== "string" ||
        typeof p.title !== "string" ||
        typeof p.lng !== "number" ||
        !Number.isFinite(p.lng) ||
        Math.abs(p.lng) > 180 ||
        typeof p.lat !== "number" ||
        !Number.isFinite(p.lat) ||
        Math.abs(p.lat) > 90
      )
        return false;
    }
    if (source.statistic !== undefined) {
      const m = source.statistic;
      if (
        !object(m) ||
        typeof m.datasetId !== "string" ||
        typeof m.geoCode !== "string" ||
        typeof m.geoLevel !== "string" ||
        typeof m.period !== "string" ||
        typeof m.unit !== "string" ||
        typeof m.value !== "number" ||
        !Number.isFinite(m.value)
      )
        return false;
    }
    ids.add(source.id);
  }
  for (const section of value.sections) {
    if (
      !object(section) ||
      typeof section.id !== "string" ||
      typeof section.title !== "string" ||
      !Array.isArray(section.claims) ||
      section.claims.length > 40
    )
      return false;
    for (const claim of section.claims)
      if (
        !object(claim) ||
        typeof claim.id !== "string" ||
        typeof claim.text !== "string" ||
        claim.text.length > 6000 ||
        !["source-statement", "visitor-report"].includes(String(claim.support)) ||
        !Array.isArray(claim.evidenceIds) ||
        !claim.evidenceIds.length ||
        claim.evidenceIds.some((id) => typeof id !== "string" || !ids.has(id))
      )
        return false;
  }
  for (const ref of value.mapRefs)
    if (
      !object(ref) ||
      typeof ref.layerId !== "string" ||
      typeof ref.featureId !== "string" ||
      typeof ref.title !== "string" ||
      typeof ref.lng !== "number" ||
      !Number.isFinite(ref.lng) ||
      Math.abs(ref.lng) > 180 ||
      typeof ref.lat !== "number" ||
      !Number.isFinite(ref.lat) ||
      Math.abs(ref.lat) > 90 ||
      !Array.isArray(ref.evidenceIds) ||
      !ref.evidenceIds.length ||
      ref.evidenceIds.some((id) => typeof id !== "string" || !ids.has(id))
    )
      return false;
  return true;
}
export function assertOverviewEvent(value: unknown): asserts value is OverviewEvent {
  if (
    !object(value) ||
    ![
      "context_ready",
      "phase",
      "sources_ready",
      "section_upsert",
      "complete",
      "partial",
      "insufficient_evidence",
      "cancelled",
      "error"
    ].includes(String(value.type)) ||
    typeof value.requestId !== "string" ||
    typeof value.runId !== "string" ||
    !Number.isSafeInteger(value.seq) ||
    !isOverviewResult(value.snapshot) ||
    value.snapshot.targetKey !== value.targetKey ||
    value.snapshot.scopeFingerprint !== value.scopeFingerprint ||
    value.snapshot.revision !== value.revision
  ) {
    throw new Error("Neplatná událost AI přehledu.");
  }
}
