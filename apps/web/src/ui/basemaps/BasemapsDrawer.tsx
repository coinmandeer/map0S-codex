import { useEffect, useMemo, useState } from "react";
import {
  BASEMAP_GROUP_LABELS,
  availableBasemaps,
  labelOverlayFor,
  type BasemapDefinition
} from "@mapos/layer-sdk";
import { t } from "../../i18n";
import { resolveBasemap } from "../../map/basemapStyle";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Chip, Icon, InfoTip, Section, Switch } from "../kit";
import { groupBasemaps } from "../basemapGroups";
import { BasemapThumb } from "./BasemapThumb";
import { shortHint } from "./basemapPresentation";

/** The one background (§4.8, §2.7).
 *
 *  Basemaps are a radio group: exactly one is chosen, and they define what the map itself looks
 *  like. Raster overlays that redraw map structure (railways, trails, CyclOSM Lite) used to live
 *  here too; they are additive like any other layer, so they belong in Vrstvy and are only
 *  offered there.
 */
export function BasemapsDrawer() {
  const store = getMapStore();
  const basemapId = useMapStoreSnapshot((s) => s.basemapId);
  const labels = useMapStoreSnapshot((s) => s.basemapLabels);
  const buildings = useMapStoreSnapshot((s) => s.buildings3d);
  const terrain = useMapStoreSnapshot((s) => s.terrain3d);
  const theme = useMapStoreSnapshot((s) => s.theme);
  const capabilities = useMapStoreSnapshot((s) => s.capabilities);

  const grouped = useMemo(() => groupBasemaps(availableBasemaps(capabilities)), [capabilities]);

  // What is drawn can differ from what is selected: a light design paired with a dark theme
  // swaps to its dark twin, and the twin should not look like a second selected row.
  const drawn = resolveBasemap(basemapId, theme);
  const overlay = drawn.imagery ? labelOverlayFor(drawn, capabilities) : null;
  const canExtrude = Boolean(drawn.buildingSourceLayer);

  // Not an accordion: three controls that every background choice interacts with, so a fold
  // would cost a click on the way to the thing the user already came here to change (§2.4).
  const general = (
    <Section eyebrow={t("basemaps.general")} testId="basemap-general">
      <div className="basemap-general">
        <div className="basemap-setting">
          <span className="basemap-setting-label">{t("basemaps.labels")}</span>
          <InfoTip title={t("basemaps.labels")} testId="basemap-labels-info">
            {drawn.imagery
              ? overlay
                ? `Názvy míst kreslíme ze zdroje ${overlay.label}.`
                : "Pro tento podklad není dostupná vrstva popisků."
              : "Uplatní se jen u leteckých a satelitních podkladů — vektorové podklady mají názvy v sobě."}
          </InfoTip>
          <Switch
            checked={labels}
            disabled={!drawn.imagery || !overlay}
            label={t("basemaps.labels")}
            testId="toggle-basemap-labels"
            onChange={(next) => store.setBasemapLabels(next)}
          />
        </div>
        <div className="basemap-setting">
          <span className="basemap-setting-label">{t("basemaps.buildings3d")}</span>
          <InfoTip title={t("basemaps.buildings3d")} testId="basemap-buildings-info">
            {canExtrude
              ? "Vytáhne obrysy budov do výšky a nakloní kameru."
              : "Tento podklad nenese obrysy budov — vyber vektorový podklad."}
          </InfoTip>
          <Switch
            checked={buildings}
            disabled={!canExtrude}
            label={t("basemaps.buildings3d")}
            testId="toggle-buildings-3d"
            onChange={(next) => store.setBuildings3d(next)}
          />
        </div>
        <div className="basemap-setting">
          <span className="basemap-setting-label">{t("basemaps.terrain3d")}</span>
          <InfoTip title={t("basemaps.terrain3d")} testId="basemap-terrain-info">
            Výšková data jsou globální a nezávislá na podkladu, takže reliéf funguje i nad leteckými
            snímky. Zdroj: Tilezen Terrain Tiles (NASA SRTM, ESA, USGS).
          </InfoTip>
          <Switch
            checked={terrain}
            label={t("basemaps.terrain3d")}
            testId="toggle-terrain-3d"
            onChange={(next) => store.setTerrain3d(next)}
          />
        </div>
      </div>
    </Section>
  );

  return (
    <div className="basemaps-drawer" data-testid="basemaps-drawer">
      {general}

      <div role="radiogroup" aria-label="Základní mapový podklad" className="basemap-groups">
        {grouped.map(({ group, items }) => (
          <BasemapGroupAccordion
            key={group}
            group={group}
            label={BASEMAP_GROUP_LABELS[group]}
            items={items}
            selectedId={basemapId}
            drawnId={drawn.id}
            onSelect={(id) => store.setBasemap(id)}
          />
        ))}
      </div>

      <p className="basemaps-drawer-footer" data-testid="basemap-attribution">
        {drawn.attribution.map(({ label }) => label).join(" · ")}
      </p>
    </div>
  );
}

function BasemapGroupAccordion({
  group,
  label,
  items,
  selectedId,
  drawnId,
  onSelect
}: {
  group: string;
  label: string;
  items: BasemapDefinition[];
  selectedId: string;
  drawnId: string;
  onSelect: (id: string) => void;
}) {
  const holdsSelection = items.some((basemap) => basemap.id === selectedId);
  const [open, setOpen] = useState(holdsSelection);

  // Switching to a background in a collapsed group (from a preset, a shared link or the theme
  // twin) has to reveal it, or the selected radio is somewhere the user cannot see.
  useEffect(() => {
    if (holdsSelection) setOpen(true);
  }, [holdsSelection]);

  return (
    <div className="basemap-accordion" data-basemap-group={group} data-open={open || undefined}>
      <button
        type="button"
        className="basemap-group-trigger"
        aria-expanded={open}
        data-testid={`basemap-group-${group}`}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="basemap-group-title">{label}</span>
        <span className="kit-accordion-count">{items.length}</span>
        <Icon name="expand_more" size={20} className="kit-accordion-chevron" />
      </button>
      {open && (
        <div className="basemap-cards">
          {items.map((basemap) => (
            <BasemapCard
              key={basemap.id}
              basemap={basemap}
              selected={basemap.id === selectedId}
              drawn={basemap.id === drawnId}
              onSelect={() => onSelect(basemap.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BasemapCard({
  basemap,
  selected,
  drawn,
  onSelect
}: {
  basemap: BasemapDefinition;
  selected: boolean;
  drawn: boolean;
  onSelect: () => void;
}) {
  return (
    // The note sits outside the card rather than in its trailing slot: the card is a button,
    // and a button inside a button is invalid HTML that browsers resolve by dropping the inner
    // one — the note would be unreachable.
    <div className="basemap-card-row">
      <button
        type="button"
        className="basemap-card"
        data-active={selected || undefined}
        role="radio"
        aria-checked={selected}
        data-testid={`basemap-${basemap.id}`}
        onClick={onSelect}
      >
        <BasemapThumb basemap={resolveBasemap(basemap.id, getMapStore().theme)} />
        <span className="basemap-card-copy">
          <span className="basemap-card-name">{basemap.label}</span>
          <span className="basemap-card-hint">{shortHint(basemap.hint)}</span>
        </span>
        <span className="basemap-card-trailing">
          {selected && !drawn && <Chip label="tmavá varianta" />}
          <span className="basemap-card-radio" aria-hidden />
        </span>
      </button>
      {basemap.note && (
        <InfoTip title={basemap.label} testId={`basemap-note-${basemap.id}`}>
          {basemap.note}
        </InfoTip>
      )}
    </div>
  );
}
