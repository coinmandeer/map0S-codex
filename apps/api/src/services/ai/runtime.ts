import { AiConversationStore } from "./conversation.js";
import { ProviderNeutralAiOrchestrator } from "./orchestrator.js";
import {
  createMapAiToolRegistry,
  type AiNearestPoiSource,
  type MapAiToolHandler,
  type MapAiToolHandlers
} from "./toolCatalog.js";
import type { AiToolTrace } from "./toolRegistry.js";

const unavailableOnNearestPoiPath: MapAiToolHandler = async () => {
  throw new Error("AI tool is not composed on the nearest-POI orchestration path");
};

const nearestPoiPathHandlers: MapAiToolHandlers = {
  get_current_map_context: unavailableOnNearestPoiPath,
  list_available_layers: unavailableOnNearestPoiPath,
  query_layer: unavailableOnNearestPoiPath,
  search_places: unavailableOnNearestPoiPath,
  set_layer_selection_draft: unavailableOnNearestPoiPath,
  query_saved_places: unavailableOnNearestPoiPath,
  get_feature_detail: unavailableOnNearestPoiPath,
  route_segment: unavailableOnNearestPoiPath,
  get_weather: unavailableOnNearestPoiPath,
  search_events: unavailableOnNearestPoiPath,
  web_search: unavailableOnNearestPoiPath,
  web_fetch: unavailableOnNearestPoiPath,
  create_plan_draft: unavailableOnNearestPoiPath
};

export interface ProviderNeutralAiRuntimeOptions {
  nearestPoiSource: AiNearestPoiSource;
  onToolTrace?: (trace: AiToolTrace) => void;
}

/**
 * Shared production/memory composition for the currently exposed deterministic AI path.
 *
 * The complete registry is created here so its policy, schema, timeout and audit boundary is the
 * one used by HTTP requests. Only nearest POI is exposed by the corresponding route; the other
 * handlers deliberately fail closed until a reviewed orchestration intent composes them.
 */
export function createProviderNeutralAiRuntime(options: ProviderNeutralAiRuntimeOptions) {
  const conversations = new AiConversationStore();
  const registry = createMapAiToolRegistry({
    handlers: nearestPoiPathHandlers,
    nearestPoiSource: options.nearestPoiSource,
    onTrace: options.onToolTrace
  });
  return {
    conversations,
    registry,
    orchestrator: new ProviderNeutralAiOrchestrator(registry, conversations)
  };
}
