import type {
  FilterValues,
  LayerAttribution,
  LayerManifest,
  LegendManifestV2
} from "@mapos/layer-sdk";
import { availableLayerPlugins, getLayerManifestV2 } from "../../layers/registry";
import { activityLabel } from "../../tasks/layerActivity";
import { emit } from "../../lib/events";
import { t } from "../../i18n";
import { presentationLabel } from "../../i18n/presentation";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Button, InfoTip, Slider } from "../kit";
import { legendTextEntries } from "../legendPresentation";
import { FacetControl, hasNonDefaultValue } from "./LayerFilterPopover";
import { layerIcon } from "./layerPresentation";
import { useLayerActivity } from "./LayerActivityBadge";
import { LayerRow } from "./LayerRow";
import { CategorySection } from "./CategorySection";
import type { MapLayerPlugin } from "../../layers";
import { CZECH_LAYERS } from "../../layers/plugins/czechSources";

const NO_FILTERS: FilterValues = {};
/** Audited renderers: pinsLayer, dataLayer and tileLayer implement setOpacity. */
export const OPACITY_LAYERS = new Set([
  "osm-poi",
  "user-layers",
  "my-saved-places",
  "game-quests",
  "park4night",
  "vanlife",
  "earthquakes",
  "inaturalist",
  "gbif",
  "air-quality",
  "commons-photos",
  "refuge-restrooms",
  "charging-stations",
  "mapillary",
  "active-fires",
  "openaq",
  "ebird",
  "events",
  "shared-mobility",
  "eonet",
  "webcams",
  "emodnet-bathymetry",
  "gbif-density",
  "europe-drought",
  "cams-air-quality"
]);

export function PoiLayerRow({
  plugin,
  settingsOnly = false,
  skipFacet
}: {
  plugin: MapLayerPlugin;
  settingsOnly?: boolean;
  skipFacet?: string;
}) {
  const store = getMapStore();
  const manifest = plugin.manifest;
  const name = presentationLabel("layer", manifest.id, manifest.name);
  const capabilities = useMapStoreSnapshot((s) => s.capabilities);
  const available = availableLayerPlugins(capabilities).some((p) => p.manifest.id === manifest.id);
  const activity = useLayerActivity(manifest.id);
  const active = useMapStoreSnapshot((s) => Boolean(s.activeLayers[manifest.id]?.visible));
  const filters = useMapStoreSnapshot((s) => s.activeLayers[manifest.id]?.filters ?? NO_FILTERS);
  const opacity = useMapStoreSnapshot(
    (s) => s.activeLayers[manifest.id]?.opacity ?? plugin.defaultOpacity ?? 1
  );
  const v2 = getLayerManifestV2(manifest.id);
  const locked = v2?.commerce?.access === "entitlement" || v2?.commerce?.access === "subscription";
  const facets = (v2?.filters ?? plugin.filters ?? [])
    .filter((facet) => facet.id !== skipFacet)
    .filter((facet) => manifest.id !== "osm-poi" || facet.id !== "categories");
  const changed = facets.filter((facet) =>
    hasNonDefaultValue(
      { ...facet, default: plugin.defaultFilters?.[facet.id] ?? facet.default },
      filters
    )
  ).length;
  const problem =
    active &&
    activity &&
    ["error", "partial", "pending", "zoom", "coverage", "budget", "empty"].includes(activity.phase);
  const settings = (
    <>
      {manifest.id === "osm-poi" && !skipFacet && <CategorySection />}
      {facets.map((facet) => (
        <FacetControl
          key={facet.id}
          layerId={manifest.id}
          facet={facet}
          values={filters}
          onChange={(patch) => store.setLayerFilters(manifest.id, { ...filters, ...patch })}
        />
      ))}
      {facets.length > 0 && (
        <Button
          size="sm"
          icon="undo"
          testId={`layer-filter-reset-${manifest.id}`}
          disabled={!changed}
          onClick={() =>
            store.setLayerFilters(manifest.id, {
              ...filters,
              ...Object.fromEntries(
                facets.map((facet) => [
                  facet.id,
                  plugin.defaultFilters?.[facet.id] ?? facet.default
                ])
              )
            })
          }
        >
          {t("polish.reset")}
        </Button>
      )}
      {(OPACITY_LAYERS.has(manifest.id) || CZECH_LAYERS.some((def) => def.id === manifest.id)) && (
        <Slider
          label={t("polish.opacity")}
          min={CZECH_LAYERS.some((def) => def.id === manifest.id) ? 0 : 0.2}
          max={1}
          step={0.05}
          value={opacity}
          format={(value) => `${Math.round(value * 100)} %`}
          onChange={(value) => store.setLayerOpacity(manifest.id, value)}
          testId={`layer-opacity-${manifest.id}`}
        />
      )}
      {active && (
        <div data-testid={`layer-status-${manifest.id}`}>
          <p role="status">{activityLabel(activity)}</p>
          {["error", "partial", "pending"].includes(activity?.phase ?? "") && (
            <Button onClick={() => emit("refresh-layer", { id: manifest.id })}>
              {t("action.retry")}
            </Button>
          )}
          {activity?.phase === "zoom" && (
            <Button
              onClick={() => emit("fly-to", { ...store.view, zoom: plugin.minQueryZoom ?? 8 })}
            >
              {t("polish.zoom")}
            </Button>
          )}
        </div>
      )}
      <details className="layer-details">
        <summary>
          {t("polish.sources")} · {t("polish.legend")}
        </summary>
        <p className="meta">
          {presentationLabel("description", manifest.id, manifest.description)}
        </p>
        <LayerSourceInfo legend={v2?.legend} attribution={plugin.attribution ?? []} />
      </details>
    </>
  );
  if (settingsOnly) return settings;
  return (
    <LayerRow
      id={manifest.id}
      name={name}
      icon={layerIcon(manifest.id, manifest.category)}
      active={active}
      disabled={(!available || locked) && !active}
      filtered={changed > 0}
      summary={changed ? t("polish.filters", { count: changed }) : undefined}
      notice={
        locked
          ? t("polish.locked")
          : !available
            ? t("polish.unavailable")
            : problem
              ? activityLabel(activity)
              : undefined
      }
      onChange={() => store.toggleLayer(manifest.id)}
    >
      {settings}
    </LayerRow>
  );
}

export function LayerSourceInfo({
  legend,
  attribution
}: {
  legend?: LegendManifestV2;
  attribution: readonly LayerAttribution[];
}) {
  const entries = legend ? legendTextEntries(legend) : [];
  return (
    <>
      {legend?.type === "image" && (
        <ul className="layer-info-legend">
          {legend.items
            ?.filter((item) => item.imageUrl)
            .map((item) => (
              <li key={item.label}>
                <img
                  src={item.imageUrl}
                  alt={item.label}
                  loading="lazy"
                  style={{ maxWidth: "100%", objectFit: "contain" }}
                />
              </li>
            ))}
        </ul>
      )}
      {entries.length > 0 && (
        <section>
          <h4>{t("polish.legend")}</h4>
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
        </section>
      )}
      {attribution.length > 0 && (
        <section>
          <h4>{t("polish.sources")}</h4>
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
        </section>
      )}
    </>
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
