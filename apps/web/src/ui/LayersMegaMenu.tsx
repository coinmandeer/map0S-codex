import type { OsmPoiCategoryId } from "@mapos/layer-sdk";
import { OSM_POI_CATEGORIES } from "@mapos/layer-sdk";
import { LAYER_CATALOG } from "../layers/catalog";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { CATEGORY_GROUPS, MAP_PRESETS, PIN_STYLES } from "./presets";

const MODE_LAYER_IDS = new Set(["osm-poi", "weather", "game", "user-layers"]);

export function LayersMegaMenu({ onClose, mobile }: { onClose: () => void; mobile: boolean }) {
  const store = getMapStore();
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  const presetId = useMapStoreSnapshot((s) => s.activePresetId);
  const session = useMapStoreSnapshot((s) => s.session);

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

  const extraLayers = LAYER_CATALOG.filter((entry) => !MODE_LAYER_IDS.has(entry.manifest.id));

  return (
    <>
      {mobile && <div className="sheet-backdrop" data-testid="sheet-backdrop" onClick={onClose} />}
      <div
        className={`layers-megamenu ${mobile ? "is-sheet" : ""}`}
        data-testid="overflow-menu"
        role="dialog"
        aria-label="Vrstvy a presety"
      >
        {mobile && <div className="panel-handle" />}
        <div className="overflow-title-row">
          <div className="overflow-title">Vrstvy</div>
          {mobile && (
            <button type="button" className="sheet-close" onClick={onClose} aria-label="Zavřít">
              ✕
            </button>
          )}
        </div>

        <section data-testid="usecase-menu">
          <h3 className="mega-section-title">Presety</h3>
          <div className="mega-preset-grid">
            {MAP_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`mega-preset ${presetId === preset.id ? "active" : ""}`}
                data-testid={`preset-${preset.id}`}
                onClick={() => {
                  store.applyPreset(preset);
                  store.showToast(preset.description);
                }}
              >
                <span className="mega-preset-icon">{preset.icon}</span>
                <span className="mega-preset-name">{preset.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mega-section-title">Zdroje dat</h3>
          {extraLayers.map((entry) => {
            const isActive = Boolean(active[entry.manifest.id]?.visible);
            return (
              <button
                key={entry.manifest.id}
                type="button"
                className={`overflow-item ${isActive ? "active" : ""}`}
                data-testid={`overflow-${entry.manifest.id}`}
                onClick={() => {
                  store.toggleLayer(entry.manifest.id);
                  store.showToast(
                    isActive ? `${entry.manifest.name} vypnuto` : `${entry.manifest.name} zapnuto`
                  );
                }}
              >
                <span className="overflow-icon">{entry.manifest.icon}</span>
                <span className="overflow-name">
                  {entry.manifest.name}
                  {entry.manifest.experimental && <span className="beta-badge">beta</span>}
                </span>
                <span className={`toggle small ${isActive ? "on" : ""}`} />
              </button>
            );
          })}
          {active.weather?.visible && (
            <div style={{ padding: "8px 10px" }}>
              <label className="meta">Radar průhlednost</label>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.1}
                value={active.weather.opacity}
                style={{ width: "100%", marginTop: 6 }}
                onChange={(e) => store.setLayerOpacity("weather", Number(e.target.value))}
              />
            </div>
          )}
          {session && (
            <button
              type="button"
              className="overflow-item"
              onClick={() => {
                onClose();
                store.setEditMode(true, "user-layers");
              }}
            >
              <span className="overflow-icon">✏️</span>
              <span className="overflow-name">Editovat moje vrstvy</span>
            </button>
          )}
        </section>

        <section>
          <h3 className="mega-section-title">Kategorie POI</h3>
          {CATEGORY_GROUPS.map((group) => {
            const options = Object.entries(OSM_POI_CATEGORIES).filter(
              ([, meta]) => meta.group === group.id
            );
            if (!options.length) return null;
            return (
              <div key={group.id} className="group-block" style={{ padding: "0 4px" }}>
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
        </section>
      </div>
    </>
  );
}
