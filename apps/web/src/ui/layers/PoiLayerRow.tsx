import type {
  FilterValues,
  LayerAttribution,
  LayerManifest,
  LegendManifestV2
} from "@mapos/layer-sdk";
import { getLayerManifestV2 } from "../../layers/registry";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Button, Icon, InfoTip, Switch } from "../kit";
import { legendTextEntries } from "../legendPresentation";
import { LayerFilterPopover } from "./LayerFilterPopover";
import { layerDomainColor, layerIcon, layerRowSubtitle } from "./layerPresentation";
import type { MapLayerPlugin } from "../../layers";

const NO_FILTERS: FilterValues = {};

/** One layer, one row (§4.7 ⑥): icon, name, one supporting line, then filter · info · switch.
 *
 *  Everything explanatory hangs off the `info` popover rather than sitting in the row, which is
 *  what lets twenty layers fit in a drawer without it turning into a wall of grey paragraphs.
 */
export function PoiLayerRow({ plugin }: { plugin: MapLayerPlugin }) {
  const store = getMapStore();
  const manifest = plugin.manifest;
  const active = useMapStoreSnapshot((s) => Boolean(s.activeLayers[manifest.id]?.visible));
  // Shared constant, not a fresh `{}`: the selector runs on every store read, and a new object
  // each time makes `useSyncExternalStore` see a changed snapshot and re-render forever.
  const filters = useMapStoreSnapshot((s) => s.activeLayers[manifest.id]?.filters ?? NO_FILTERS);
  const v2 = getLayerManifestV2(manifest.id);
  const locked = v2?.commerce?.access === "entitlement" || v2?.commerce?.access === "subscription";
  // The v2 manifest carries the richer facet kinds (single-select, date-range); the v1 list is
  // the same set flattened, so it only has to answer for layers registered the old way.
  const facets = v2?.filters ?? plugin.filters ?? [];

  return (
    <div className="layer-row" data-active={active || undefined}>
      <span
        className="layer-row-icon"
        style={{ color: layerDomainColor(manifest.category) }}
        aria-hidden
      >
        <Icon name={layerIcon(manifest.id, manifest.category)} size={20} filled={active} />
      </span>
      <span className="layer-row-text">
        <span className="layer-row-name">{manifest.name}</span>
        <span className="layer-row-meta">
          {layerRowSubtitle({
            description: manifest.description,
            experimental: manifest.experimental,
            locked
          })}
        </span>
      </span>
      <span className="layer-row-actions">
        {active && facets.length > 0 && (
          <LayerFilterPopover
            layerId={manifest.id}
            layerName={manifest.name}
            facets={facets}
            values={filters}
            onChange={(patch) => store.setLayerFilters(manifest.id, { ...filters, ...patch })}
            onReset={() => store.setLayerFilters(manifest.id, { ...(plugin.defaultFilters ?? {}) })}
          />
        )}
        <LayerInfoTip
          manifest={manifest}
          legend={v2?.legend}
          attribution={plugin.attribution ?? []}
        />
        {locked ? (
          <Button
            variant="tonal"
            size="sm"
            icon="lock"
            testId={`layer-unlock-${manifest.id}`}
            onClick={() => store.showToast("Odemknutí vrstev připravujeme")}
          >
            Odemknout
          </Button>
        ) : (
          <Switch
            checked={active}
            label={manifest.name}
            testId={`overflow-${manifest.id}`}
            onChange={() => {
              store.toggleLayer(manifest.id);
              // Events only make sense next to their timeline, which lives in Discover.
              if (!active && manifest.id === "events") {
                store.setMode("discover");
                store.setSidebarOpen(true);
              }
              store.showToast(
                active
                  ? `${manifest.name} vypnuto`
                  : manifest.id === "events"
                    ? `${manifest.name} otevřeny v Objevuj`
                    : `${manifest.name} zapnuto`
              );
            }}
          />
        )}
      </span>
    </div>
  );
}

export function LayerInfoTip({
  manifest,
  legend,
  attribution
}: {
  manifest: LayerManifest;
  legend?: LegendManifestV2;
  attribution: readonly LayerAttribution[];
}) {
  const entries = legend ? legendTextEntries(legend) : [];
  return (
    <InfoTip title={manifest.name} testId={`layer-info-${manifest.id}`}>
      <p>{manifest.description}</p>
      {entries.length > 0 && (
        <>
          <span className="kit-eyebrow">{legend?.title ?? "Legenda"}</span>
          <ul className="layer-info-legend">
            {entries.map((entry) => (
              <li key={entry.label}>
                {entry.color && (
                  <span className="layer-info-swatch" style={{ background: entry.color }} />
                )}
                {entry.label}
              </li>
            ))}
          </ul>
        </>
      )}
      {attribution.length > 0 && (
        <>
          <span className="kit-eyebrow">Zdroje dat</span>
          <ul className="layer-info-sources">
            {attribution.map((item) => (
              <li key={item.label}>
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.label}
                  </a>
                ) : (
                  item.label
                )}
                {item.license ? ` · ${item.license}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </InfoTip>
  );
}
