import type { PlanDocumentV2 } from "@mapos/layer-sdk";
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
      opacityByLayer?: Record<string, number>;
      time?: string | null;
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
  | {
      type: "plan";
      draft?: PlanDocumentV2;
      title: string;
      summary: string;
      stops: AiPlanStop[];
      profile?: "foot" | "bike" | "car";
      route?: {
        coordinates: [number, number][];
        distanceM: number;
        durationS: number;
        legs?: {
          coordinates: [number, number][];
          distanceM: number;
          durationS: number;
          provider: string;
          profile: string;
        }[];
      };
      routeNotice?: string;
    }
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
  | {
      type: "scene_patch";
      patch: import("@mapos/layer-sdk").MapScenePatch;
      conversationId: string;
      runId: string;
      revision: number;
    }
  | {
      type: "map_artifact";
      phase?: "preview" | "final";
      artifactId: string;
      conversationId: string;
      revision: number;
      runId: string;
    }
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
