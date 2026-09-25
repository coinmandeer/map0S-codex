import { presentationLabel } from "../../i18n/presentation";
import { useStatistics } from "../../statistics/explorerStore";
import { st } from "../../statistics/labels";
import { useEffect, useMemo, useState } from "react";
import { OSM_POI_CATEGORIES, type LayerCategory } from "@mapos/layer-sdk";
import { on } from "../../lib/events";
import { t } from "../../i18n";
import { allLayerPlugins, availableLayerPlugins, type MapLayerPlugin } from "../../layers";
import { isStructuralTileOverlayId } from "../../layers/plugins/tileLayers";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import {
  Accordion,
  Button,
  EmptyState,
  Section,
  SearchField,
  SegmentedButton,
  type AccordionSection
} from "../kit";
import { LAYER_CATEGORY_LABELS, LAYER_CATEGORY_ORDER } from "../layerLabels";
import { CategorySection } from "./CategorySection";
import { PoiLayerRow } from "./PoiLayerRow";
import { PresetStrip } from "./PresetStrip";
import { SavePresetDialog } from "./SavePresetDialog";
import { ThemesSection } from "./ThemesSection";
import { WeatherLayerSettings } from "./WeatherLayerSettings";
import { isWeatherLayerId } from "../../layers/weather/controls";
import { WorldSection } from "./WorldSection";
import { EventsSection } from "./EventsSection";
import { drawerSummary } from "./layerPresentation";

/** Everything additive that can go on the map (§4.7).
 *
 *  The basemap is deliberately not here: exactly one can be active and it replaces the style,
 *  while everything in this drawer stacks. Keeping the two apart is what makes "put our pins
 *  over someone else's aerial photo" a thing the UI can express at all.
 */
export function LayersDrawer() {
  const store = getMapStore();
  const statistics = useStatistics();
  const [catalogQuery, setCatalogQuery] = useState("");
  const [onlyActive, setOnlyActive] = useState(() => {
    try {
      return sessionStorage.getItem("mapos:catalog-only-active") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem("mapos:catalog-only-active", onlyActive ? "1" : "0");
    } catch {
      /* storage can be unavailable */
    }
  }, [onlyActive]);
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  const capabilities = useMapStoreSnapshot((s) => s.capabilities);
  const experienceId = useMapStoreSnapshot((s) => s.experienceId);
  const visibleFeatures = useMapStoreSnapshot((s) => s.visibleFeatures);

  // Not every layer is known at startup: one built from a pasted URL registers when the user's
  // layer list loads, which changes the catalogue without changing anything this component
  // reads. The counter is what makes that registration visible here.
  const [catalogVersion, setCatalogVersion] = useState(0);
  useEffect(() => on("layers-changed", () => setCatalogVersion((current) => current + 1)), []);

  const grouped = useMemo(
    () => groupPoiLayers(capabilities, experienceId),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogVersion is the signal, not a value read below.
    [capabilities, experienceId, catalogVersion]
  );

  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const query = normalize(catalogQuery.trim());
  const aliases: Record<string, string> = {
    cyclosm: "kolo cyklo",
    "waymarked-trails": "kolo turistika",
    webcams: "kamera kamery",
    "air-quality-grid": "vzduch ovzdusi",
    "gbif-density": "priroda zvirata"
  };
  const filteredGroups = grouped
    .map(
      ([category, plugins]) =>
        [
          category,
          plugins.filter(
            (plugin) =>
              (!onlyActive || active[plugin.manifest.id]?.visible) &&
              (!query ||
                normalize(
                  `${presentationLabel("layer", plugin.manifest.id, plugin.manifest.name)} ${plugin.manifest.name} ${plugin.manifest.description ?? ""} ${aliases[plugin.manifest.id] ?? ""}`
                ).includes(query))
          )
        ] as const
    )
    .filter(([, plugins]) => plugins.length);
  const weatherOn = Object.entries(active).some(
    ([id, state]) => isWeatherLayerId(id) && state.visible
  );

  // Themes are counted apart from the layer tally in the footer: they are one switch each in
  // their own section, and folding them into "5 layers on" makes both numbers harder to trust.
  const themeCount = Object.entries(active).filter(
    ([id, state]) => state.visible && id.startsWith("theme-")
  ).length;

  const layerCount = Object.entries(active).filter(
    ([id, state]) =>
      state.visible &&
      id !== "weather" &&
      !isWeatherLayerId(id) &&
      !id.startsWith("theme-") &&
      !isStructuralTileOverlayId(id)
  ).length;
  const overlayCount = Object.entries(active).filter(
    ([id, state]) => state.visible && isStructuralTileOverlayId(id)
  ).length;
  const featureCount = Object.entries(visibleFeatures)
    .filter(([id]) => active[id]?.visible)
    .reduce((sum, [, features]) => sum + features.length, 0);

  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>([]);
  const eventsOn = Boolean(active.events?.visible);

  const sections: AccordionSection[] = [
    {
      id: "world",
      title: t("layers.sources"),
      icon: "public",
      testId: "source-selector",
      children: <WorldSection />
    },
    {
      id: "themes",
      title: st("Statistiky a společnost", "Statistics and society"),
      icon: "bar_chart",
      testId: "themes-accordion",
      count: themeCount,
      children: <ThemesSection query={query} onlyActive={onlyActive} />
    }
  ];

  return (
    <div className="layers-drawer" data-testid="overflow-menu">
      <Section
        eyebrow={t("layers.presets")}
        testId="usecase-menu"
        action={
          <Button
            variant="text"
            size="sm"
            icon="bookmark"
            testId="save-preset-open"
            onClick={() => setSavePresetOpen(true)}
          >
            {t("presets.save")}
          </Button>
        }
      >
        <PresetStrip />
      </Section>
      <SavePresetDialog open={savePresetOpen} onOpenChange={setSavePresetOpen} />

      <div className="layers-catalog-toolbar">
        <SearchField
          label={t("polish.search")}
          placeholder={t("polish.searchHint")}
          value={catalogQuery}
          onChange={(event) => setCatalogQuery(event.target.value)}
          testId="layers-search"
        />
        <SegmentedButton
          options={[
            { value: "all", label: t("polish.all") },
            { value: "active", label: t("polish.active") }
          ]}
          value={onlyActive ? "active" : "all"}
          onChange={(value) => setOnlyActive(value === "active")}
          ariaLabel={t("polish.displayed")}
          testId="layers-view"
          block
        />
      </div>
      {query && <CategorySection query={query} onlyActive={onlyActive} />}
      {query &&
        allLayerPlugins()
          .filter(
            (plugin) =>
              isStructuralTileOverlayId(plugin.manifest.id) &&
              (!onlyActive || active[plugin.manifest.id]?.visible) &&
              normalize(
                `${presentationLabel("layer", plugin.manifest.id, plugin.manifest.name)} ${plugin.manifest.name} ${plugin.manifest.description ?? ""} ${aliases[plugin.manifest.id] ?? ""}`
              ).includes(query)
          )
          .map((plugin) => (
            <Button
              key={plugin.manifest.id}
              variant="text"
              onClick={() => store.openSheet("basemap")}
            >
              {plugin.manifest.name} · {t("polish.overlays")}
            </Button>
          ))}
      <Accordion
        sections={sections.filter((section) => {
          const keywords: Record<string, string> = {
            categories: `${Object.values(OSM_POI_CATEGORIES)
              .map((category) => category.label)
              .join(" ")} koupani toalety`,
            themes: `statistiky spolecnost obyvatelstvo volby ${statistics.catalog.map((item) => item.name).join(" ")}`,
            weather: "pocasi teplota dest vitr snih",
            events: "udalosti koncerty festivaly"
          };
          const on: Record<string, boolean> = {
            categories: Boolean(active["osm-poi"]?.visible || active["refuge-restrooms"]?.visible),
            themes: themeCount > 0,
            weather: weatherOn,
            events: eventsOn
          };
          return (
            (!onlyActive || on[section.id]) &&
            (!query || normalize(`${section.title} ${keywords[section.id] ?? ""}`).includes(query))
          );
        })}
        value={query ? sections.map((section) => section.id) : openSections}
        onValueChange={setOpenSections}
        testId="layers-accordion"
      />

      {(!onlyActive || weatherOn) &&
        (!query ||
          normalize(
            `${t("layers.weather")} pocasi weather temperature teplota vitr wind rain`
          ).includes(query)) &&
        Object.entries(active)
          .filter(([id, state]) => isWeatherLayerId(id) && state.visible)
          .map(([id]) => <WeatherLayerSettings key={id} layerId={id} />)}
      {(!onlyActive || eventsOn) &&
        (!query ||
          normalize(`${t("polish.events")} koncerty festivaly concerts`).includes(query)) && (
          <EventsSection />
        )}

      <Section title={t("layers.poi")}>
        {filteredGroups.length === 0 ? (
          <EmptyState icon="layers" title={t("layers.empty")} />
        ) : (
          filteredGroups.map(([category, plugins]) => {
            const onInCategory = plugins.filter((plugin) => active[plugin.manifest.id]?.visible);
            return (
              <div className="layer-group" key={category}>
                <div className="layer-group-header">
                  <span className="kit-eyebrow">
                    {presentationLabel(
                      "domain",
                      category,
                      LAYER_CATEGORY_LABELS[category] ?? category
                    )}
                  </span>
                  {/* Turning a category off one row at a time is the common case after trying a
                      preset, and the drawer-wide clear is too blunt for it. */}
                  {onInCategory.length > 0 && (
                    <Button
                      variant="text"
                      size="sm"
                      testId={`layer-group-clear-${category}`}
                      onClick={() => {
                        for (const plugin of onInCategory) store.toggleLayer(plugin.manifest.id);
                      }}
                    >
                      {t("layers.clearCategory")}
                    </Button>
                  )}
                </div>
                {plugins.map((plugin) => (
                  <PoiLayerRow key={plugin.manifest.id} plugin={plugin} />
                ))}
              </div>
            );
          })
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
          {t("layers.manageMine")}
        </Button>
      </Section>

      <p className="layers-drawer-footer" data-testid="layers-summary">
        {drawerSummary({ layerCount, overlayCount, weatherOn, featureCount })}
      </p>
    </div>
  );
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
  for (const plugin of allLayerPlugins()) {
    const { manifest } = plugin;
    if (isStructuralTileOverlayId(manifest.id)) continue;
    if (isWeatherLayerId(manifest.id)) continue;
    if (manifest.id === "events") continue;
    // Themes have their own section with a sources popover per switch; listing them here too
    // would give one theme two switches that disagree the moment a source is turned off.
    if (manifest.category === "statistics") continue;
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
