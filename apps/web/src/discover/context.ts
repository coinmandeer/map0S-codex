import type { Bbox, Guide, MapViewState } from "@mapos/layer-sdk";
import { apiGet } from "../lib/api";
import { activeLocale } from "../i18n";

export type DiscoverRegionLevel = "country" | "admin1" | "admin2" | "locality" | "neighbourhood";

export interface DiscoverViewport extends MapViewState {
  bbox?: Bbox;
  areaId?: string;
  boundaryRevision?: string;
  useCase?: string;
  activeLayerIds?: string[];
  allowModelFallback?: boolean;
}

export interface DiscoverContext {
  schemaVersion: "2.0.0";
  key: string;
  generatedAt: string;
  cache: { hit: boolean; expiresAt: string };
  region: null | {
    id: string;
    name: string;
    level: DiscoverRegionLevel;
    countryCode: string | null;
    hierarchy: Array<{ name: string; level: DiscoverRegionLevel }>;
  };
  guide: Guide | null;
  synthesis: null | {
    kind: "structured" | "model";
    label: string;
    text: string;
    sourceIds: string[];
    model?: string;
  };
  /** The multi-source guide of §30.5. Every claim carries the ids of the sources it came from,
   *  and its last fallback is an empty state with an action rather than nothing. */
  guideSynthesis: null | {
    kind: "model" | "structured" | "extract" | "none";
    label: string;
    lead: string;
    leadSourceIds?: string[];
    highlights: Array<{
      title: string;
      text: string;
      sourceIds: string[];
      place?: { id: string; longitude: number; latitude: number; layerId?: string };
    }>;
    practical: { arrival?: string; bestTime?: string; warnings: string[] };
    degraded: string[];
    model?: string;
    action?: { id: "ask-ai-web"; label: string };
  };
  statistics: Array<{
    id: string;
    label: string;
    value: number;
    unit: string;
    scope: {
      regionId: string;
      regionName: string;
      level: DiscoverRegionLevel;
      geographicCode?: string;
    };
    year: number | null;
    uncertainty: string;
    uncertaintyLabel: string;
    sourceIds: string[];
  }>;
  regionCatalogue: null | {
    nutsLevel: 0 | 1 | 2 | 3 | "lau";
    truncated: boolean;
    sourceId: string;
    regions: Array<{
      id: string;
      code: string;
      name: string;
      nutsLevel: 0 | 1 | 2 | 3 | "lau";
      geometry:
        | { type: "Polygon"; coordinates: number[][][] }
        | { type: "MultiPolygon"; coordinates: number[][][][] };
      sourceId: string;
    }>;
  };
  sources: Array<{
    id: string;
    label: string;
    attribution: string;
    url: string;
    license: string | null;
    fetchedAt: string;
  }>;
  capabilities?: Array<{
    id: string;
    label: string;
    kind: "guide" | "statistics" | "region-catalogue";
    status: "ready" | "empty" | "error";
    sourceIds: string[];
  }>;
  blocks: Array<{
    id: "region" | "guide" | "statistics" | "model";
    status: "ready" | "empty" | "skipped";
    sourceIds: string[];
  }>;
  boundary: {
    status: "dataset-required" | "ready";
    geometry:
      | null
      | { type: "Polygon"; coordinates: number[][][] }
      | { type: "MultiPolygon"; coordinates: number[][][][] };
    reason: string;
    sourceId?: string | null;
  };
  emptyState: null | { title: string; message: string; actions: string[] };
}

export function loadDiscoverContext(
  viewport: DiscoverViewport,
  signal?: AbortSignal
): Promise<DiscoverContext> {
  return apiGet<DiscoverContext>("/v2/discover/context", {
    signal,
    query: {
      areaId: viewport.areaId,
      boundaryRevision: viewport.boundaryRevision,
      lng: viewport.lng,
      lat: viewport.lat,
      zoom: viewport.zoom,
      bbox: viewport.bbox?.join(","),
      // The server picks which Wikipedia and which summary language to answer in, so the
      // guide follows the interface language rather than always speaking Czech.
      lang: activeLocale(),
      useCase: viewport.useCase,
      layers: viewport.activeLayerIds,
      model: viewport.allowModelFallback ? 1 : undefined
    }
  });
}
