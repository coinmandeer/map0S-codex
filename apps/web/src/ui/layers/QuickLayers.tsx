import { useEffect, useState } from "react";
import { allLayerPlugins, getLayerPlugin } from "../../layers";
import { inCzechBounds } from "../../layers/plugins/czechSources";
import { on } from "../../lib/events";
import { getShellStore } from "../../store/shellStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { st } from "../../statistics/labels";
import { useStatistics } from "../../statistics/explorerStore";
import { Icon } from "../kit";
import { CATALOG_GROUPS, catalogItemState, type CatalogItem } from "./catalogModel";
import { useCatalogActions } from "./useCatalogActions";
import { requestLayerSettings, useFavoriteLayers } from "./useFavoriteLayers";

export function QuickLayers() {
  const { favorites } = useFavoriteLayers();
  const { change, reasonFor } = useCatalogActions();
  const layers = useMapStoreSnapshot((s) => s.activeLayers);
  const view = useMapStoreSnapshot((s) => s.view);
  const statistics = useStatistics();
  const [, refresh] = useState(0);
  useEffect(() => on("layers-changed", () => refresh((n) => n + 1)), []);
  const catalog: CatalogItem[] = [
    ...CATALOG_GROUPS.flatMap((group) => group.items),
    ...statistics.catalog.map((theme) => ({
      id: `theme-${theme.id}`,
      layer: `theme-${theme.id}`,
      cs: theme.name,
      en: theme.name
    })),
    ...allLayerPlugins().map((plugin) => ({
      id: plugin.manifest.id,
      layer: plugin.manifest.id,
      cs: plugin.manifest.name,
      en: plugin.manifest.name
    }))
  ];
  const selected = favorites
    .map((id) => catalog.find((item) => item.id === id))
    .filter((item): item is CatalogItem => Boolean(item));
  const defaults = inCzechBounds(view.lng, view.lat)
    ? ["cz-cadastre", "cz-networks", "cz-flood-q100"]
    : [];
  const items = (
    selected.length ? selected : defaults.map((id) => catalog.find((item) => item.id === id)!)
  ).slice(0, 3);
  if (!items.length) return null;
  const shortNames: Record<string, [string, string]> = {
    "cz-cadastre": ["Katastr", "Cadastre"],
    "cz-networks": ["Sítě", "Networks"],
    "cz-flood-q100": ["Záplavy Q100", "Floods Q100"]
  };
  return (
    <div
      className="quick-layers"
      role="group"
      aria-label={st("Rychlé vrstvy", "Quick layers")}
      data-testid="quick-layers"
    >
      {items.map((item) => {
        const enabled = catalogItemState(item, layers).enabled;
        const reason = reasonFor(item);
        const zoomRequired = enabled && view.zoom < (getLayerPlugin(item.layer)?.minQueryZoom ?? 0);
        const name = st(item.cs, item.en);
        const short = shortNames[item.id];
        return (
          <div className="quick-layer" data-active={enabled || undefined} key={item.id}>
            <button
              type="button"
              aria-pressed={enabled}
              disabled={!!reason && !enabled}
              data-testid={`quick-toggle-${item.id}`}
              title={
                reason ?? (zoomRequired ? st("Přibližte mapu", "Zoom in to see this layer") : name)
              }
              onClick={() => change(item, !enabled)}
            >
              <span>{short ? st(...short) : name}</span>
              {zoomRequired && <small>{st("Přibližte mapu", "Zoom in")}</small>}
            </button>
            <button
              type="button"
              aria-label={`${st("Nastavení", "Settings")}: ${name}`}
              data-testid={`quick-settings-${item.id}`}
              onClick={() => {
                try {
                  sessionStorage.setItem("mapos:map-tab", "layers");
                } catch {
                  /* optional */
                }
                requestLayerSettings(item.id);
                getShellStore().openRightUtility("layers");
              }}
            >
              <Icon name="expand_more" size={18} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
