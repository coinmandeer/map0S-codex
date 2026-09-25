import type { GeoFeature, MapViewState } from "@mapos/layer-sdk";
import { distanceMeters, featureAnchor } from "@mapos/layer-sdk";

export interface DiscoverMapFeature {
  feature: GeoFeature;
  layerId: string;
  distance: number;
  name: string;
  category: string;
}

/**
 * Keyboard/touch companion for features rendered in MapLibre's canvas.
 *
 * This deliberately consumes only the already-loaded layer results: it does not start a second
 * POI query and it does not resurrect the removed Planning POI catalogue. Keeping it scoped to
 * Discover makes the guide usable for people who cannot reliably hit a small canvas marker.
 */
export function discoverMapFeatures(
  activeLayers: Record<string, { visible: boolean }>,
  visibleFeatures: Record<string, GeoFeature[]>,
  view: MapViewState,
  limit = 24
): DiscoverMapFeature[] {
  const entries: DiscoverMapFeature[] = [];

  for (const [layerId, layerState] of Object.entries(activeLayers)) {
    if (!layerState.visible) continue;
    for (const feature of visibleFeatures[layerId] ?? []) {
      const [lng, lat] = featureAnchor(feature);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const name =
        typeof feature.properties.name === "string" && feature.properties.name.trim()
          ? feature.properties.name.trim()
          : "Místo bez názvu";
      const category =
        typeof feature.properties.category === "string" && feature.properties.category.trim()
          ? feature.properties.category.trim()
          : layerId;
      entries.push({
        feature,
        layerId,
        distance: distanceMeters(view, { lng, lat }),
        name,
        category
      });
    }
  }

  return entries
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
    .slice(0, Math.max(0, limit));
}
