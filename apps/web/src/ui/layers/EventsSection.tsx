import { getLayerManifestV2 } from "../../layers/registry";
import { LayerSourceInfo } from "./PoiLayerRow";
import { Slider } from "../kit";
import { EventExplorerPanel } from "../../events/EventExplorerPanel";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { t } from "../../i18n";
import { LayerRow } from "./LayerRow";
export function EventsSection() {
  const store = getMapStore();
  const active = useMapStoreSnapshot((state) => Boolean(state.activeLayers.events?.visible));
  const opacity = useMapStoreSnapshot((state) => state.activeLayers.events?.opacity ?? 1);
  const view = useMapStoreSnapshot((state) => state.view);
  return (
    <div data-testid="events-section">
      <LayerRow
        id="events"
        name={t("polish.events")}
        icon="event"
        active={active}
        testId="events-layer-switch"
        onChange={() => store.toggleLayer("events")}
      >
        <p className="meta">{t("polish.eventsDescription")}</p>
        <EventExplorerPanel view={view} />
        <Slider
          label={t("polish.opacity")}
          min={0.2}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(value) => store.setLayerOpacity("events", value)}
          testId="layer-opacity-events"
        />
        <LayerSourceInfo attribution={getLayerManifestV2("events")?.attribution ?? []} />
      </LayerRow>
    </div>
  );
}
