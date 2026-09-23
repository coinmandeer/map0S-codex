import type { LayerManifestV2 } from "@mapos/layer-sdk";
export interface AiPlace {
  sourceFeatureId?: string;
  id: string;
  layerId: string;
  title: string;
  category: string;
  longitude: number;
  latitude: number;
  distanceMeters?: number;
  sourceId: string;
}

export interface AiCitation {
  sourceId: string;
  label: string;
  url?: string;
}

export interface AiPlanStop {
  title: string;
  longitude: number;
  latitude: number;
  day?: number;
  note?: string;
  sourceId: string;
}

export interface AiPlanDiff {
  baseRevision: number;
  previewRevision: number;
  changedPlanFields: string[];
  addedStopIds: string[];
  removedStopIds: string[];
  movedStopIds: string[];
  updatedStopIds: string[];
  affectedSegmentIds: string[];
}

export type AiStatisticCard = {
  type: "statistic";
  title: string;
  themeId: string;
  period: string;
  country: string;
  geoLevel: string;
  bbox: [number, number, number, number];
  excludedDatasetIds: string[];
  available: boolean;
};

export type AiCard =
  | AiStatisticCard
  | { type: "places"; title: string; places: AiPlace[]; layerIds: string[] }
  | { type: "link"; title: string; url: string; excerpt?: string }
  | {
      type: "layer";
      title: string;
      layerIds: string[];
      filters?: { openNow?: boolean; minRating?: number; tags?: string[] };
    }
  | {
      type: "facts";
      title: string;
      items: { label: string; value: string; note?: string; sourceIds: string[] }[];
    }
  | {
      type: "layer-draft";
      title: string;
      layerId: string;
      manifest: LayerManifestV2;
      featureCount: number;
    }
  | { type: "plan"; title: string; summary: string; stops: AiPlanStop[] }
  | { type: "plan-edit"; title: string; proposalId: string; planId: string; diff: AiPlanDiff };

export interface AiAnswer {
  execution: "model-tool-loop" | "deterministic";
  intent: string;
  text: string;
  cards: AiCard[];
  sources: AiCitation[];
  followUps: string[];
  model?: string;
}

export type AiChatEvent =
  | { type: "conversation"; conversation: { id: string; revision: number } }
  | { type: "intent"; intent: string; execution: AiAnswer["execution"] }
  | { type: "token"; text: string }
  | { type: "tool_start"; tool: string; title: string }
  | { type: "tool_result"; tool: string; status: string }
  | { type: "card"; card: AiCard }
  | { type: "sources"; sources: AiCitation[] }
  | { type: "done"; answer: AiAnswer; conversation: { id: string; revision: number } }
  | { type: "error"; code: string; message: string };

export interface Turn {
  scopeKey: string;
  scopeLabel: string;
  requestedAt: string;
  id: string;
  question: string;
  text: string;
  step: string | null;
  cards: AiCard[];
  sources: AiCitation[];
  followUps: string[];
  done: boolean;
  error: string | null;
}
