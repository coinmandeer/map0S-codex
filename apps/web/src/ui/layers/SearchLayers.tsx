import "./searchLayers.css";
import { useEffect, useMemo, useState } from "react";
import { catalogSearchScore, LAYER_ALIASES, CATALOG_DATA } from "@mapos/layer-sdk";
import { allLayerPlugins } from "../../layers";
import { on } from "../../lib/events";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { CATALOG_GROUPS, catalogItemState, type CatalogItem } from "./catalogModel";
import { useCatalogActions } from "./useCatalogActions";
import { Switch, Slider } from "../kit";

export function SearchLayers({ query }: { query: string }) {
  const [version, setVersion] = useState(0);
  useEffect(() => on("layers-changed", () => setVersion((v) => v + 1)), []);
  const layers = useMapStoreSnapshot((s) => s.activeLayers);
  const { change, reasonFor } = useCatalogActions();
  const matches = useMemo(() => {
    void version;
    const catalog = CATALOG_GROUPS.flatMap((g) => g.items);
    const groups = new Map(
      CATALOG_GROUPS.flatMap((g) => g.items.map((item) => [item.id, [g.cs, g.en]] as const))
    );
    const known = new Set(catalog.map((i) => i.layer));
    const extra: CatalogItem[] = allLayerPlugins()
      .filter((p) => !known.has(p.manifest.id) && !p.manifest.id.startsWith("ai-answer-"))
      .map((p) => ({
        id: p.manifest.id,
        layer: p.manifest.id,
        cs: p.manifest.name,
        en: p.manifest.name
      }));
    return [...catalog, ...extra]
      .map((item) => ({
        item,
        score: catalogSearchScore(
          query,
          [item.cs, item.en],
          [
            ...(LAYER_ALIASES[item.id] ?? LAYER_ALIASES[item.layer] ?? []),
            ...(groups.get(item.id) ?? [])
          ]
        )
      }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || a.item.cs.localeCompare(b.item.cs))
      .slice(0, 8);
  }, [query, version]);
  if (!matches.length) return null;
  return (
    <section className="command-search-section" aria-label="Vrstvy">
      <div className="command-search-section-title">Vrstvy</div>
      {matches.map(({ item }) => {
        const { enabled } = catalogItemState(item, layers);
        const reason = reasonFor(item);
        return (
          <div key={item.id} className="command-search-layer">
            <div className="command-search-layer-heading">
              <span title={CATALOG_DATA[item.layer]?.description}>{item.cs}</span>
              <Switch
                label={item.cs}
                checked={enabled}
                disabled={Boolean(reason)}
                onChange={(next) => change(item, next)}
              />
            </div>
            {reason && <small>{reason}</small>}
            {enabled && (
              <Slider
                min={0}
                max={1}
                step={0.05}
                label={`Průhlednost: ${item.cs}`}
                value={layers[item.layer]?.opacity ?? 1}
                onChange={(value) => getMapStore().setLayerOpacity(item.layer, value)}
              />
            )}
          </div>
        );
      })}
    </section>
  );
}
