import { useEffect, useMemo, useState } from "react";
import type { LayerCategory } from "@mapos/layer-sdk";
import { t } from "../../i18n/cs";
import { availableLayerPlugins, type MapLayerPlugin } from "../../layers";
import { isStructuralTileOverlayId } from "../../layers/plugins/tileLayers";
import { resolveWeatherVisualization } from "../../layers/weather/controls";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Accordion, Button, EmptyState, Section, type AccordionSection } from "../kit";
import { LAYER_CATEGORY_LABELS, LAYER_CATEGORY_ORDER } from "../layerLabels";
import { MAP_PRESETS } from "../presets";
import { CategorySection, selectedCategories } from "./CategorySection";
import { PoiLayerRow } from "./PoiLayerRow";
import { PresetStrip } from "./PresetStrip";
import { WeatherSection, activeWeatherLabel } from "./WeatherSection";
import { WorldSection } from "./WorldSection";
import { drawerSummary } from "./layerPresentation";
import { experienceById } from "../../product/registry";

/** Everything additive that can go on the map (§4.7).
 *
 *  The basemap is deliberately not here: exactly one can be active and it replaces the style,
 *  while everything in this drawer stacks. Keeping the two apart is what makes "put our pins
 *  over someone else's aerial photo" a thing the UI can express at all.
 */
export function LayersDrawer() {
  const store = getMapStore();
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  const capabilities = useMapStoreSnapshot((s) => s.capabilities);
  const experienceId = useMapStoreSnapshot((s) => s.experienceId);
  const visibleFeatures = useMapStoreSnapshot((s) => s.visibleFeatures);
  const activePresetId = useMapStoreSnapshot((s) => s.activePresetId);

  const grouped = useMemo(
    () => groupPoiLayers(capabilities, experienceId),
    [capabilities, experienceId]
  );

  const weatherOn = Boolean(active.weather?.visible);
  const weatherVisualization = resolveWeatherVisualization(active.weather?.filters ?? {});
  const categories = selectedCategories(active["osm-poi"]?.filters);

  const layerCount = Object.entries(active).filter(
    ([id, state]) => state.visible && id !== "weather" && !isStructuralTileOverlayId(id)
  ).length;
  const overlayCount = Object.entries(active).filter(
    ([id, state]) => state.visible && isStructuralTileOverlayId(id)
  ).length;
  const featureCount = Object.entries(visibleFeatures)
    .filter(([id]) => active[id]?.visible)
    .reduce((sum, [, features]) => sum + features.length, 0);

  // Weather opens with the drawer whenever the layer is on: the radio group is the only place
  // the active visualization can be read or changed, and arriving from a preset or a shared
  // link should not require guessing which fold hides it.
  const [openSections, setOpenSections] = useState<string[]>(() => (weatherOn ? ["weather"] : []));
  useEffect(() => {
    if (!weatherOn) return;
    setOpenSections((current) => (current.includes("weather") ? current : [...current, "weather"]));
  }, [weatherOn]);

  const sections: AccordionSection[] = [
    {
      id: "world",
      title: t("layers.world"),
      icon: "public",
      testId: "experience-selector",
      action: <span className="kit-eyebrow">{experienceById(experienceId).name}</span>,
      children: <WorldSection />
    },
    {
      id: "categories",
      title: t("layers.categories"),
      icon: "label",
      count: categories.length,
      testId: "category-accordion",
      // Which preset the selection came from, or that it no longer matches any of them. Without
      // it a preset card can look active while the categories underneath have been edited.
      action: <span className="kit-eyebrow">{presetLabel(activePresetId)}</span>,
      children: <CategorySection />
    },
    {
      id: "weather",
      title: t("layers.weather"),
      icon: "rainy",
      testId: "weather-accordion",
      action: (
        <span className="kit-eyebrow">{activeWeatherLabel(weatherOn, weatherVisualization)}</span>
      ),
      children: <WeatherSection />
    }
  ];

  return (
    <div className="layers-drawer" data-testid="overflow-menu">
      <Section eyebrow={t("layers.presets")} testId="usecase-menu">
        <PresetStrip />
      </Section>

      <Accordion
        sections={sections}
        value={openSections}
        onValueChange={setOpenSections}
        testId="layers-accordion"
      />

      <Section title={t("layers.poi")}>
        {grouped.length === 0 ? (
          <EmptyState icon="layers" title={t("layers.empty")} />
        ) : (
          grouped.map(([category, plugins]) => (
            <div className="layer-group" key={category}>
              <span className="kit-eyebrow">{LAYER_CATEGORY_LABELS[category] ?? category}</span>
              {plugins.map((plugin) => (
                <PoiLayerRow key={plugin.manifest.id} plugin={plugin} />
              ))}
            </div>
          ))
        )}
        <Button
          variant="text"
          size="sm"
          icon="edit"
          testId="manage-user-layers-shortcut"
          onClick={() => {
            store.setMode("personal");
            store.setSidebarOpen(true);
          }}
        >
          Spravovat moje vrstvy
        </Button>
      </Section>

      <p className="layers-drawer-footer" data-testid="layers-summary">
        {drawerSummary({ layerCount, overlayCount, weatherOn, featureCount })}
      </p>
    </div>
  );
}

function presetLabel(activePresetId: string | null): string {
  const preset = MAP_PRESETS.find((item) => item.id === activePresetId);
  return preset ? preset.name : "Vlastní výběr";
}

/** Header action for the drawer chrome. Lives here because "what counts as switched on" is the
 *  same question the footer answers, and both must agree. */
export function LayersClearAll() {
  const store = getMapStore();
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  const ids = Object.entries(active)
    .filter(([, state]) => state.visible)
    .map(([id]) => id);
  if (ids.length === 0) return null;

  return (
    <Button
      variant="text"
      size="sm"
      testId="layers-clear-all"
      onClick={() => {
        for (const id of ids) store.toggleLayer(id);
        store.showToast("Všechny vrstvy vypnuté");
      }}
    >
      {t("layers.clearAll")}
    </Button>
  );
}

/** POI and thematic layers by category. Structural raster overlays (a railway or trail map on
 *  top of the background) belong to the basemaps drawer, and weather has its own exclusive
 *  group, so both are filtered out here rather than listed twice. */
export function groupPoiLayers(
  capabilities: Parameters<typeof availableLayerPlugins>[0],
  experienceId: string
): Array<readonly [LayerCategory, MapLayerPlugin[]]> {
  const byCategory = new Map<LayerCategory, MapLayerPlugin[]>();
  for (const plugin of availableLayerPlugins(capabilities)) {
    const { manifest } = plugin;
    if (isStructuralTileOverlayId(manifest.id)) continue;
    if (manifest.id === "weather") continue;
    if (manifest.experienceIds?.length && !manifest.experienceIds.includes(experienceId)) continue;
    const list = byCategory.get(manifest.category) ?? [];
    list.push(plugin);
    byCategory.set(manifest.category, list);
  }
  const known = LAYER_CATEGORY_ORDER.filter((category) => byCategory.has(category));
  const rest = [...byCategory.keys()].filter(
    (category) => !LAYER_CATEGORY_ORDER.includes(category)
  );
  return [...known, ...rest].map((category) => [category, byCategory.get(category)!] as const);
}
