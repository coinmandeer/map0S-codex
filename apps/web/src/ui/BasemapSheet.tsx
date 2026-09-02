import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  BASEMAP_GROUP_LABELS,
  availableBasemaps,
  labelOverlayFor,
  type BasemapDefinition,
  type BasemapGroup,
  type LayerCategory
} from "@mapos/layer-sdk";
import { availableLayerPlugins, type MapLayerPlugin } from "../layers";
import { isStructuralTileOverlayId } from "../layers/plugins/tileLayers";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { resolveBasemap } from "../map/basemapStyle";
import { groupBasemaps } from "./basemapGroups";
import { LAYER_CATEGORY_LABELS, LAYER_CATEGORY_ORDER } from "./layerLabels";
import { Sheet, SheetSection, SettingRow, Toggle } from "./primitives";

/**
 * Map settings: one background, many place sources.
 *
 * The two used to be the same switch — picking Mapy.com swapped the tiles *and* the search
 * results — which made it impossible to do the thing this whole panel exists for: put someone
 * else's aerial photo under our own pins and see which of them is telling the truth.
 */

export function BasemapSheet() {
  const store = getMapStore();
  return (
    <Sheet title="Mapové podklady" onClose={() => store.closeSheet()} testId="tiles-sheet">
      <BasemapContent />
    </Sheet>
  );
}

/** Shared body used by both the compatibility Sheet and the AppShell right utility drawer. */
export function BasemapContent() {
  const store = getMapStore();
  const basemapId = useMapStoreSnapshot((s) => s.basemapId);
  const labels = useMapStoreSnapshot((s) => s.basemapLabels);
  const buildings = useMapStoreSnapshot((s) => s.buildings3d);
  const theme = useMapStoreSnapshot((s) => s.theme);
  const capabilities = useMapStoreSnapshot((s) => s.capabilities);
  const activeLayers = useMapStoreSnapshot((s) => s.activeLayers);

  const grouped = useMemo(() => {
    return groupBasemaps(availableBasemaps(capabilities));
  }, [capabilities]);

  const structuralGroups = useMemo(() => {
    const byCategory = new Map<LayerCategory, MapLayerPlugin[]>();
    for (const plugin of availableLayerPlugins(capabilities)) {
      if (!isStructuralTileOverlayId(plugin.manifest.id)) continue;
      const list = byCategory.get(plugin.manifest.category) ?? [];
      list.push(plugin);
      byCategory.set(plugin.manifest.category, list);
    }
    const known = LAYER_CATEGORY_ORDER.filter((category) => byCategory.has(category));
    const rest = [...byCategory.keys()].filter(
      (category) => !LAYER_CATEGORY_ORDER.includes(category)
    );
    return [...known, ...rest].map((category) => [category, byCategory.get(category)!] as const);
  }, [capabilities]);

  // What is drawn can differ from what is selected: a light design paired with a dark theme
  // swaps to its dark twin, and the twin should not look like a second selected row.
  const drawn = resolveBasemap(basemapId, theme);
  const overlay = drawn.imagery ? labelOverlayFor(drawn, capabilities) : null;
  const canExtrude = Boolean(drawn.buildingSourceLayer);

  return (
    <>
      <SheetSection title="Obecné nastavení">
        <SettingRow
          label="Popisky nad snímky"
          hint={
            drawn.imagery
              ? overlay
                ? `Názvy míst z: ${overlay.label}`
                : "Pro tento podklad není dostupná vrstva popisků"
              : "Uplatní se jen u leteckých a satelitních podkladů"
          }
          control={
            <Toggle
              on={labels}
              onChange={(next) => store.setBasemapLabels(next)}
              label="Popisky nad snímky"
              disabled={!drawn.imagery || !overlay}
              testId="toggle-basemap-labels"
            />
          }
        />
        <SettingRow
          label="3D budovy"
          hint={
            canExtrude
              ? "Vytáhne budovy do výšky podle dat podkladu"
              : "Tento podklad nenese obrysy budov — vyber vektorový podklad"
          }
          control={
            <Toggle
              on={buildings}
              onChange={(next) => store.setBuildings3d(next)}
              label="3D budovy"
              disabled={!canExtrude}
              testId="toggle-buildings-3d"
            />
          }
        />
      </SheetSection>

      <div role="radiogroup" aria-label="Základní mapový podklad">
        {grouped.map(({ group, items }) => (
          <BasemapGroupAccordion
            key={group}
            group={group}
            items={items}
            selectedId={basemapId}
            onSelect={(id) => store.setBasemap(id)}
          />
        ))}
      </div>

      <SheetSection
        title="Specializované překryvy"
        description="Volitelné mapové struktury se kombinují se zvoleným podkladem i mezi sebou."
      >
        {structuralGroups.map(([category, plugins]) => (
          <div key={category} className="group-block structural-overlay-group">
            <div className="group-title">{LAYER_CATEGORY_LABELS[category]}</div>
            {plugins.map(({ manifest }) => {
              const isActive = Boolean(activeLayers[manifest.id]?.visible);
              return (
                <button
                  key={manifest.id}
                  type="button"
                  className={`overflow-item ${isActive ? "active" : ""}`}
                  data-testid={`overflow-${manifest.id}`}
                  data-surface-kind="structural-overlay"
                  aria-pressed={isActive}
                  onClick={() => {
                    store.toggleLayer(manifest.id);
                    store.showToast(
                      isActive ? `${manifest.name} vypnuto` : `${manifest.name} zapnuto`
                    );
                  }}
                >
                  <span className="overflow-icon">{manifest.icon}</span>
                  <span className="overflow-name structural-overlay-copy">
                    <strong>{manifest.name}</strong>
                    <small>{manifest.description}</small>
                  </span>
                  <span className={`toggle small ${isActive ? "on" : ""}`} />
                </button>
              );
            })}
          </div>
        ))}
      </SheetSection>
    </>
  );
}

function BasemapGroupAccordion({
  group,
  items,
  selectedId,
  onSelect
}: {
  group: BasemapGroup;
  items: BasemapDefinition[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const selected = items.some((basemap) => basemap.id === selectedId);
  const [open, setOpen] = useState(selected);

  useEffect(() => {
    if (selected) setOpen(true);
  }, [selected]);

  return (
    <details
      className="basemap-accordion"
      open={open}
      data-basemap-group={group}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary data-testid={`basemap-group-${group}`}>
        <span>{BASEMAP_GROUP_LABELS[group]}</span>
        <small>{items.length}</small>
      </summary>
      <div className="basemap-grid">
        {items.map((basemap) => (
          <BasemapCard
            key={basemap.id}
            basemap={basemap}
            selected={basemap.id === selectedId}
            onSelect={() => onSelect(basemap.id)}
          />
        ))}
      </div>
    </details>
  );
}

function BasemapCard({
  basemap,
  selected,
  onSelect
}: {
  basemap: BasemapDefinition;
  selected: boolean;
  onSelect: () => void;
}) {
  const hue = [...basemap.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
  const previewKind = basemap.imagery
    ? "satellite"
    : basemap.group === "terrain" || basemap.group === "outdoor"
      ? basemap.group
      : basemap.id.includes("dark")
        ? "dark"
        : "street";
  const previewStyle = { "--basemap-preview-hue": `${hue}` } as CSSProperties;

  return (
    <button
      type="button"
      className={`basemap-card${selected ? " active" : ""}`}
      onClick={onSelect}
      role="radio"
      aria-checked={selected}
      aria-pressed={selected}
      data-testid={`basemap-${basemap.id}`}
    >
      <span
        className="basemap-preview"
        data-preview-kind={previewKind}
        style={previewStyle}
        aria-hidden="true"
      >
        <span className="basemap-preview-water" />
        <span className="basemap-preview-road road-primary" />
        <span className="basemap-preview-road road-secondary" />
        <span className="basemap-preview-place">Evropa</span>
      </span>
      <span className="basemap-card-copy">
        <strong>{basemap.label}</strong>
        <span className="basemap-hint" title={basemap.hint}>
          {basemap.hint}
        </span>
        {basemap.note && <span className="basemap-note">{basemap.note}</span>}
      </span>
    </button>
  );
}
