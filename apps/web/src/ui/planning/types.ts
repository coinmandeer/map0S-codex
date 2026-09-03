import type { Position } from "@mapos/layer-sdk";

/** Wire shapes the planning panel reads. They live here so the panel and the row, footer and
 *  assistant components can share them without importing each other. */

export interface PlanExportResponse {
  filename: string;
  mimeType: string;
  content: string;
}

export interface AiStopResult {
  id: string;
  layerId: string;
  title: string;
  longitude: number;
  latitude: number;
  distanceMeters: number;
  source: { sourceId: string; label: string; url?: string };
}

export interface AiStopAnswer {
  status: "succeeded";
  answer: { text: string; results: AiStopResult[] };
}

export interface PlanShareLink {
  id: string;
  planId: string;
  permission: "view";
  createdAt: string;
  revokedAt: string | null;
}

export interface PlanDiscussionMessage {
  id: string;
  revision: number;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  disclosure: string | null;
  createdAt: string;
}

export interface PlanDiscussionThread {
  id: string;
  planId: string;
  revision: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  messages: PlanDiscussionMessage[];
}

export interface AdventureCandidate {
  id: string;
  placeId: string;
  name: string;
  category: string;
  location: Position;
  segmentIndex: number;
  insertIndex: number;
  score: number;
  scoreBreakdown: {
    interest: number;
    detourEfficiency: number;
    sourceConfidence: number;
  };
  baselineDistanceM: number;
  viaDistanceM: number;
  detourM: number;
  detourPercent: number;
  source: { id: string; reference: string | null };
  explanation: string;
}

export interface AdventureRecommendation {
  algorithm: {
    version: string;
    deterministic: true;
    formula: string;
    detourLimitPercent: number;
    minimumEndpointDistanceM: number;
  };
  suggestions: AdventureCandidate[];
  coverage: {
    totalSegments: number;
    scannedSegments: number;
    placesEvaluated: number;
    eligiblePlaces: number;
  };
  dataBudget: {
    sources: ["osm"];
    categories: string[];
    maxScannedSegments: number;
    maxRoutedCandidates: number;
    maxReturnedSuggestions: number;
    providerCalls: number;
  };
  sourceStates: Array<{ source: string; state: string; count: number }>;
  warnings: string[];
}

/** The GPS fallback and the "enter coordinates by hand" menu item open the same block. */
export interface StopManualState {
  stopId: string;
  reason: "manual" | "denied" | "unavailable";
  message?: string;
}
