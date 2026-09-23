import type { PlaceSourceId } from "@mapos/layer-sdk";
import { RELEASED_PLACE_SOURCES } from "@mapos/layer-sdk";
import { t } from "../../i18n";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Chip, Icon, InfoTip, Switch, type IconName } from "../kit";

/** POI source switches. World selection lives in the logo menu and restores its own layer stack. */
export function WorldSection() {
  const store = getMapStore();
  const poiSources = useMapStoreSnapshot((s) => s.poiSources);
  const capabilities = useMapStoreSnapshot((s) => s.capabilities);

  return (
    <div className="layers-world">
      <div className="layers-subsection">
        <div className="layers-subsection-header">
          <span className="kit-eyebrow">{t("layers.sources")}</span>
          <InfoTip title={t("layers.sources")} testId="place-sources-info">
            {t("polish.sourcesHelp")}
          </InfoTip>
        </div>
        {RELEASED_PLACE_SOURCES.map((source) => {
          const unavailable = sourceUnavailable(source.id, source.needsKey, capabilities);
          const enabled = Boolean(poiSources[source.id]) && !unavailable;
          return (
            <div className="layers-source-row" key={source.id} data-enabled={enabled || undefined}>
              <Icon name={placeSourceIcon(source.id)} size={20} className="layers-source-icon" />
              <span className="layers-source-name">{source.label}</span>
              {unavailable && <Chip label={t("polish.noKey")} />}
              <Switch
                checked={enabled}
                disabled={unavailable}
                label={source.label}
                testId={`layer-source-${source.id}`}
                onChange={(next) => store.setPoiSource(source.id, next)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PLACE_SOURCE_ICONS: Record<string, IconName> = {
  osm: "public",
  mapy: "map",
  wikidata: "science",
  wikipedia: "menu_book",
  overture: "grid_on",
  park4night: "rv_hookup",
  fsq: "storefront",
  user: "group"
};

export function placeSourceIcon(id: string): IconName {
  return PLACE_SOURCE_ICONS[id] ?? "place";
}

/** A keyed source the server cannot serve is shown disabled rather than hidden: the user asked
 *  for it once, and "the deployment has no key" is a different answer from "it does not exist". */
export function sourceUnavailable(
  id: PlaceSourceId,
  needsKey: boolean,
  capabilities: Record<string, boolean | string> | null
): boolean {
  if (!needsKey) return false;
  if (id === "mapy") return capabilities?.mapy === false;
  if (id === "fsq") return capabilities?.fsq === false;
  return false;
}
