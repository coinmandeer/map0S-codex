import { useMemo, useRef, type KeyboardEvent } from "react";
import type { LayerCategory, OsmPoiCategoryId, PlaceSourceId } from "@mapos/layer-sdk";
import { OSM_POI_CATEGORIES, RELEASED_PLACE_SOURCES } from "@mapos/layer-sdk";
import { availableLayerPlugins, type MapLayerPlugin } from "../layers";
import { isStructuralTileOverlayId } from "../layers/plugins/tileLayers";
import {
  resolveWeatherVisualization,
  WEATHER_VISUALIZATIONS,
  weatherVisualizationFilters,
  type WeatherVisualizationId
} from "../layers/weather/controls";
import { experienceById, experienceRegistry } from "../product/registry";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { Icon, type IconName } from "./kit";
import { LAYER_CATEGORY_LABELS, LAYER_CATEGORY_ORDER } from "./layerLabels";
import { nextPresetIndex } from "./presetNavigation";
import { CATEGORY_GROUPS, MAP_PRESETS, PIN_STYLES } from "./presets";

export function LayersMegaMenu({
  onClose,
  mobile,
  embedded = false
}: {
  onClose: () => void;
  mobile: boolean;
  /** AppShell supplies the drawer frame/header; reuse only this component's current content. */
  embedded?: boolean;
}) {
  const store = getMapStore();
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  const presetId = useMapStoreSnapshot((s) => s.activePresetId);
  const capabilities = useMapStoreSnapshot((s) => s.capabilities);
  const experienceId = useMapStoreSnapshot((s) => s.experienceId);
  const poiSources = useMapStoreSnapshot((s) => s.poiSources);
  const presetStripRef = useRef<HTMLDivElement>(null);

  const categories =
    (active["osm-poi"]?.filters?.categories as OsmPoiCategoryId[] | undefined) ??
    (["restaurant", "cafe", "parking", "viewpoint"] as OsmPoiCategoryId[]);

  const ensureOsm = () => {
    if (!active["osm-poi"]?.visible) store.toggleLayer("osm-poi");
  };

  const toggleCategory = (id: OsmPoiCategoryId) => {
    ensureOsm();
    const next = categories.includes(id) ? categories.filter((c) => c !== id) : [...categories, id];
    store.setLayerFilters("osm-poi", { categories: next });
  };

  // Data and temporal layers stay here. Structural raster overlays are controlled alongside the
  // base map, but remain part of the same additive runtime layer stack.
  const groupedExtras = useMemo(() => {
    const byCategory = new Map<LayerCategory, MapLayerPlugin[]>();
    for (const plugin of availableLayerPlugins(capabilities)) {
      if (isStructuralTileOverlayId(plugin.manifest.id)) continue;
      // Weather has one purpose-built exclusive group below; listing it here as a second toggle
      // would recreate two independent sources of truth.
      if (plugin.manifest.id === "weather") continue;
      if (
        plugin.manifest.experienceIds?.length &&
        !plugin.manifest.experienceIds.includes(experienceId)
      )
        continue;
      const list = byCategory.get(plugin.manifest.category) ?? [];
      list.push(plugin);
      byCategory.set(plugin.manifest.category, list);
    }
    const known = LAYER_CATEGORY_ORDER.filter((c) => byCategory.has(c));
    const rest = [...byCategory.keys()].filter((c) => !LAYER_CATEGORY_ORDER.includes(c));
    return [...known, ...rest].map((c) => [c, byCategory.get(c)!] as const);
  }, [capabilities, experienceId]);

  const sourceUnavailable = (id: PlaceSourceId, needsKey: boolean) => {
    if (!needsKey) return false;
    if (id === "mapy") return capabilities?.mapy === false;
    if (id === "fsq") return capabilities?.fsq === false;
    return false;
  };

  const experience = experienceById(experienceId);
  const weatherActive = Boolean(active.weather?.visible);
  const weatherVisualization = resolveWeatherVisualization(active.weather?.filters ?? {});

  const selectWeather = (visualization: WeatherVisualizationId | "off") => {
    if (visualization === "off") {
      if (store.activeLayers.weather?.visible) store.toggleLayer("weather");
      store.showToast("Počasí vypnuto");
      return;
    }
    if (!store.activeLayers.weather?.visible) store.toggleLayer("weather");
    const current = store.activeLayers.weather?.filters ?? {};
    store.setLayerFilters("weather", weatherVisualizationFilters(current, visualization));
    const label = WEATHER_VISUALIZATIONS.find(({ id }) => id === visualization)?.label;
    store.showToast(`${label ?? "Počasí"} zapnuto`);
  };

  const navigatePresets = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const strip = presetStripRef.current;
    if (!strip) return;
    const buttons = [...strip.querySelectorAll<HTMLButtonElement>("[data-preset-index]")];
    const current = buttons.indexOf(event.target);
    const next = nextPresetIndex(current, event.key, buttons.length);
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus({ preventScroll: true });
    buttons[next]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  };

  return (
    <>
      {mobile && !embedded && (
        <div className="sheet-backdrop" data-testid="sheet-backdrop" onClick={onClose} />
      )}
      <div
        className={`layers-megamenu ${mobile ? "is-sheet" : ""} ${embedded ? "is-embedded" : ""}`}
        data-testid="overflow-menu"
        role={embedded ? "region" : "dialog"}
        aria-label="Vrstvy a presety"
      >
        {mobile && !embedded && <div className="panel-handle" />}
        <div className="overflow-title-row">
          <div className="overflow-title">Vrstvy</div>
          {mobile && !embedded && (
            <button type="button" className="sheet-close" onClick={onClose} aria-label="Zavřít">
              ✕
            </button>
          )}
        </div>

        <details className="layer-accordion world-accordion" data-testid="experience-selector">
          <summary>
            <span className="layer-accordion-title">
              <strong>Svět</strong>
              <small>Prostředí, zdroje míst a jejich dostupnost</small>
            </span>
            <span className="layer-summary-value">{experience.name}</span>
          </summary>
          <div className="layer-accordion-body">
            <div className="experience-grid">
              {experienceRegistry.list().map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`experience-card ${experienceId === item.id ? "active" : ""}`}
                  aria-pressed={experienceId === item.id}
                  data-testid={`experience-${item.id}`}
                  onClick={() => {
                    store.setExperience(item.id);
                    store.showToast(`${item.name}: vrstvy zůstaly zachované`);
                  }}
                >
                  <span className="experience-icon">
                    <Icon name={item.icon as IconName} size={20} />
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.description}</small>
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost experience-recommendation"
              onClick={() => {
                store.applyPreset({
                  id: `experience-${experience.id}`,
                  layers: experience.recommendedIntegrationIds
                });
                store.showToast(`Doporučené integrace pro ${experience.name} byly přidány`);
              }}
            >
              Přidat doporučené vrstvy
            </button>
            <div className="group-block world-sources">
              <div className="group-title">Zdroje míst</div>
              {RELEASED_PLACE_SOURCES.map((source) => {
                const disabled = sourceUnavailable(source.id, source.needsKey);
                const isActive = Boolean(poiSources[source.id]) && !disabled;
                return (
                  <button
                    key={source.id}
                    type="button"
                    className={`overflow-item ${isActive ? "active" : ""}`}
                    disabled={disabled}
                    data-testid={`layer-source-${source.id}`}
                    aria-pressed={isActive}
                    onClick={() => store.setPoiSource(source.id, !isActive)}
                  >
                    <span className="overflow-icon source-glyph">{source.glyph}</span>
                    <span className="overflow-name">
                      {source.label}
                      <small>{disabled ? "Nedostupné" : source.hint}</small>
                    </span>
                    <span className={`toggle small ${isActive ? "on" : ""}`} />
                  </button>
                );
              })}
            </div>
          </div>
        </details>

        <section data-testid="usecase-menu">
          <h3 className="mega-section-title">Presety</h3>
          <div
            ref={presetStripRef}
            className="mega-preset-grid"
            data-testid="preset-strip"
            role="group"
            aria-label="Presety vrstev"
            onKeyDown={navigatePresets}
          >
            {MAP_PRESETS.map((preset, index) => (
              <button
                key={preset.id}
                type="button"
                className={`mega-preset ${presetId === preset.id ? "active" : ""}`}
                data-testid={`preset-${preset.id}`}
                data-preset-index={index}
                onClick={() => {
                  store.applyPreset(preset);
                  store.showToast(preset.description);
                }}
              >
                <span className="mega-preset-icon">{preset.icon}</span>
                <span className="mega-preset-copy">
                  <span className="mega-preset-name">{preset.name}</span>
                  <small>{preset.description}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mega-section-title">Počasí</h3>
          <fieldset className="weather-radio-group" data-testid="weather-radio-group">
            <legend>Zobrazení počasí</legend>
            <p className="meta">Jedna veličina v mapě · radar RainViewer, předpověď Open-Meteo</p>
            <div className="weather-radio-options">
              <label className={!weatherActive ? "active" : ""}>
                <input
                  type="radio"
                  name="weather-visualization"
                  value="off"
                  checked={!weatherActive}
                  onChange={() => selectWeather("off")}
                />
                <span aria-hidden>○</span>
                Vypnuto
              </label>
              {WEATHER_VISUALIZATIONS.map((option) => {
                const selected = weatherActive && weatherVisualization === option.id;
                return (
                  <label key={option.id} className={selected ? "active" : ""}>
                    <input
                      type="radio"
                      name="weather-visualization"
                      value={option.id}
                      checked={selected}
                      onChange={() => selectWeather(option.id)}
                      data-testid={`weather-visualization-${option.id}`}
                    />
                    <span aria-hidden>{option.id === "radar" ? "◉" : "◌"}</span>
                    {option.label}
                    <small>{option.unit}</small>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </section>

        <section>
          <h3 className="mega-section-title">POI vrstvy</h3>
          {groupedExtras.map(([category, plugins]) => (
            <div key={category} className="group-block">
              <div className="group-title">{LAYER_CATEGORY_LABELS[category]}</div>
              {plugins.map(({ manifest }) => {
                const isActive = Boolean(active[manifest.id]?.visible);
                return (
                  <button
                    key={manifest.id}
                    type="button"
                    className={`overflow-item ${isActive ? "active" : ""}`}
                    data-testid={`overflow-${manifest.id}`}
                    onClick={() => {
                      store.toggleLayer(manifest.id);
                      if (!isActive && manifest.id === "events") {
                        store.setMode("discover");
                        store.setSidebarOpen(true);
                      }
                      store.showToast(
                        isActive
                          ? `${manifest.name} vypnuto`
                          : manifest.id === "events"
                            ? `${manifest.name} otevřeny v Objevuj`
                            : `${manifest.name} zapnuto`
                      );
                    }}
                  >
                    <span className="overflow-icon">{manifest.icon}</span>
                    <span className="overflow-name">
                      {manifest.name}
                      {manifest.experimental && <span className="beta-badge">beta</span>}
                    </span>
                    <span className={`toggle small ${isActive ? "on" : ""}`} />
                  </button>
                );
              })}
            </div>
          ))}
        </section>

        <details className="layer-accordion categories-accordion" data-testid="category-accordion">
          <summary>
            <span className="layer-accordion-title">
              <strong>Kategorie</strong>
              <small>{presetId ? "Výběr podle presetu" : "Vlastní výběr"}</small>
            </span>
            <span className="layer-summary-value" data-testid="selected-category-count">
              {categories.length} vybráno
            </span>
          </summary>
          <div className="layer-accordion-body">
            {CATEGORY_GROUPS.map((group) => {
              const options = Object.entries(OSM_POI_CATEGORIES).filter(
                ([, meta]) => meta.group === group.id
              );
              if (!options.length) return null;
              return (
                <div key={group.id} className="group-block category-group">
                  <div className="group-title">{group.label}</div>
                  <div className="tag-grid">
                    {options.map(([id, meta]) => {
                      const selected = categories.includes(id as OsmPoiCategoryId);
                      const style = PIN_STYLES[id];
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`tag ${selected ? "selected" : ""}`}
                          data-testid={`filter-${id}`}
                          aria-pressed={selected}
                          style={selected ? { background: style?.color ?? "#B7791F" } : undefined}
                          onClick={() => toggleCategory(id as OsmPoiCategoryId)}
                        >
                          {meta.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      </div>
    </>
  );
}
