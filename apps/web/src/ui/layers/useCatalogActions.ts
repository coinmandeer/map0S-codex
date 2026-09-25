import { getMapStore } from "../../store/mapStore";
import { layerUnavailableReason } from "../../layers/registry";
import {
  activateStatistic,
  deactivateStatistic,
  useStatistics
} from "../../statistics/explorerStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { st } from "../../statistics/labels";
import { catalogItemPatch, type CatalogItem } from "./catalogModel";
import { themeLayerId } from "../../layers/themes/themeLayers";

/** One action path for catalogue rows, subgroup controls and map shortcuts. */
export function useCatalogActions() {
  const store = getMapStore();
  const statistics = useStatistics();
  const capabilities = useMapStoreSnapshot((s) => s.capabilities);
  const reasonFor = (item: CatalogItem) => {
    if (item.layer.startsWith("theme-")) {
      const theme = statistics.catalog.find((t) => themeLayerId(t.id) === item.layer);
      return theme?.available === false || theme?.coverageStatus === "none"
        ? st("Pro tento výřez nejsou data", "No data in this view")
        : undefined;
    }
    return layerUnavailableReason(
      item.layer,
      capabilities,
      item.facet ? { [item.facet]: item.values } : undefined
    );
  };
  const change = (item: CatalogItem, enabled: boolean, remove = false) => {
    if (enabled && reasonFor(item)) return;
    if (item.layer.startsWith("theme-")) {
      if (enabled) void activateStatistic(item.layer.slice(6));
      else {
        if (statistics.activeId === item.layer.slice(6)) deactivateStatistic();
        if (remove) store.removeLayer(item.layer);
        else store.setLayerVisible(item.layer, false);
      }
      return;
    }
    applyCatalogItem(item, enabled, remove);
  };

  return { reasonFor, change };
}

/** Shared imperative action for the catalog, search and verified AI scene changes. */
export function applyCatalogItem(item: CatalogItem, enabled: boolean, remove = false) {
  const store = getMapStore();
  if (
    enabled &&
    layerUnavailableReason(
      item.layer,
      store.state.capabilities,
      item.facet ? { [item.facet]: item.values } : undefined
    )
  )
    return;
  const patch = catalogItemPatch(item, store.activeLayers, enabled, remove);
  if (patch) {
    if (!store.activeLayers[item.layer]) store.activateLayer(item.layer, patch);
    store.setLayerFilters(item.layer, patch);
    store.setLayerVisible(
      item.layer,
      Array.isArray(patch[item.facet!]) && (patch[item.facet!] as unknown[]).length > 0
    );
  } else if (remove) store.removeLayer(item.layer);
  else store.setLayerVisible(item.layer, enabled);
  if (remove)
    for (const ref of item.related ?? []) {
      if (typeof ref === "string" || !ref.facet) continue; // Shared sources have independent controls.
      const sub: CatalogItem = {
        id: ref.layer,
        layer: ref.layer,
        cs: "",
        en: "",
        facet: ref.facet,
        values: ref.values
      };
      const patch = catalogItemPatch(sub, store.activeLayers, false, true);
      if (patch && store.activeLayers[ref.layer]) {
        store.setLayerFilters(ref.layer, patch);
        store.setLayerVisible(ref.layer, (patch[ref.facet] as unknown[]).length > 0);
      }
    }
}
