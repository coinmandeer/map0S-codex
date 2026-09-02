import type { LayerManifestV2 } from "@mapos/layer-sdk";

export interface AiLayerCatalogActor {
  authenticated: boolean;
  ownedLayerIds: ReadonlySet<string>;
  entitlementIds: ReadonlySet<string>;
}

export interface AiLayerCatalogEntry {
  layerId: string;
  name: string;
  description: string;
  categories: string[];
  queryCapabilities: Array<"bbox" | "filters" | "time" | "cursor" | "realtime">;
  availableFields: string[];
  access: "public" | "authenticated" | "entitled" | "owner" | "metadata-only";
  allowedTools: string[];
  maySendRawFieldsToExternalModel: boolean;
}

const READ_ONLY_AI_TOOLS = new Set([
  "search_locations",
  "geocode",
  "reverse_geocode",
  "get_current_map_context",
  "list_available_layers",
  "query_layer",
  "query_saved_places",
  "get_feature_detail",
  "get_feature_enrichment",
  "search_events",
  "get_weather",
  "route_segment",
  "route_matrix",
  "create_suggested_layer",
  "create_plan_draft",
  "export_plan",
  "get_region_context"
]);

function actorCanSee(manifest: LayerManifestV2, actor: AiLayerCatalogActor): boolean {
  const visibility = manifest.permissions?.defaultVisibility ?? "public";
  if (manifest.permissions?.requiresAuth && !actor.authenticated) return false;
  if (visibility === "private" && !actor.ownedLayerIds.has(manifest.id)) return false;
  if (
    visibility === "entitled" &&
    (!manifest.commerce?.productId || !actor.entitlementIds.has(manifest.commerce.productId))
  ) {
    return false;
  }

  const commerceAccess = manifest.commerce?.access ?? "free";
  if (
    (commerceAccess === "entitlement" ||
      commerceAccess === "subscription" ||
      commerceAccess === "one-time") &&
    (!manifest.commerce?.productId || !actor.entitlementIds.has(manifest.commerce.productId))
  ) {
    return false;
  }
  return true;
}

function projectedAccess(manifest: LayerManifestV2): AiLayerCatalogEntry["access"] {
  const projection = manifest.ai?.permissionProjection;
  if (projection === "metadata-only") return "metadata-only";
  if (projection === "owner-private") return "owner";
  if (projection === "entitled-features") return "entitled";
  if (manifest.permissions?.requiresAuth) return "authenticated";
  return "public";
}

function queryCapabilities(manifest: LayerManifestV2): AiLayerCatalogEntry["queryCapabilities"] {
  const values: AiLayerCatalogEntry["queryCapabilities"] = [];
  if (["viewport", "tile", "realtime"].includes(manifest.queryPolicy.strategy)) {
    values.push("bbox");
  }
  if (manifest.filters?.length) values.push("filters");
  if (manifest.temporal?.enabled) values.push("time");
  if (manifest.queryPolicy.cursorPagination) values.push("cursor");
  if (manifest.queryPolicy.strategy === "realtime") values.push("realtime");
  return values;
}

/**
 * Produces metadata for the model, never feature data. Omitting a layer here improves privacy and
 * UX, but every actual tool invocation must still repeat its own authorization check.
 */
export function projectAiLayerCatalog(
  manifests: readonly LayerManifestV2[],
  actor: AiLayerCatalogActor
): AiLayerCatalogEntry[] {
  const entries: AiLayerCatalogEntry[] = [];
  for (const manifest of manifests) {
    const projection = manifest.ai?.permissionProjection;
    if (!manifest.ai?.discoverable || projection === "disabled" || !actorCanSee(manifest, actor)) {
      continue;
    }
    if (projection === "owner-private" && !actor.ownedLayerIds.has(manifest.id)) continue;
    if (
      projection === "entitled-features" &&
      (!manifest.commerce?.productId || !actor.entitlementIds.has(manifest.commerce.productId))
    ) {
      continue;
    }

    const access = projectedAccess(manifest);
    entries.push({
      layerId: manifest.id,
      name: manifest.name,
      description: manifest.description,
      categories: [manifest.category],
      queryCapabilities: queryCapabilities(manifest),
      availableFields: [...new Set(manifest.ai.searchableFields ?? [])].sort(),
      access,
      allowedTools: [...new Set(manifest.ai.tools ?? [])]
        .filter((tool) => READ_ONLY_AI_TOOLS.has(tool))
        .sort(),
      maySendRawFieldsToExternalModel:
        projection === "public-features" &&
        access === "public" &&
        (manifest.commerce?.access ?? "free") === "free"
    });
  }
  return entries.sort((a, b) => a.layerId.localeCompare(b.layerId));
}
