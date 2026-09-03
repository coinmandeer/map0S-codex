import type { PlaceSourceId } from "@mapos/layer-sdk";
import { RELEASED_PLACE_SOURCES } from "@mapos/layer-sdk";
import { t } from "../../i18n/cs";
import { experienceRegistry } from "../../product/registry";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Chip, Icon, InfoTip, RadioGroup, Switch, type IconName } from "../kit";

/** Which world the map belongs to, and which upstreams may put a pin on it (§4.7 ②).
 *
 *  Both belong together because they answer the same question — what am I looking at — and
 *  because switching world keeps the layer stack: the game is a universe you turn on, not a
 *  different app.
 */
export function WorldSection() {
  const store = getMapStore();
  const experienceId = useMapStoreSnapshot((s) => s.experienceId);
  const poiSources = useMapStoreSnapshot((s) => s.poiSources);
  const capabilities = useMapStoreSnapshot((s) => s.capabilities);

  const worlds = experienceRegistry.list();

  return (
    <div className="layers-world">
      <RadioGroup
        ariaLabel={t("layers.world")}
        value={experienceId}
        testId="world-options"
        options={worlds.map((world) => ({
          value: world.id,
          label: (
            <span className="layers-world-label">
              <Icon name={world.icon as IconName} size={20} />
              {world.name}
            </span>
          ),
          description: world.description
        }))}
        onChange={(next) => {
          store.setExperience(next);
          const world = worlds.find((item) => item.id === next);
          store.showToast(`${world?.name ?? next}: vrstvy zůstaly zachované`);
        }}
      />

      <div className="layers-subsection">
        <div className="layers-subsection-header">
          <span className="kit-eyebrow">{t("layers.sources")}</span>
          <InfoTip title={t("layers.sources")} testId="place-sources-info">
            Body na mapě skládáme z několika katalogů a slučujeme duplicity. Vypnutím zdroje se
            místa z něj přestanou hledat i zobrazovat.
          </InfoTip>
        </div>
        {RELEASED_PLACE_SOURCES.map((source) => {
          const unavailable = sourceUnavailable(source.id, source.needsKey, capabilities);
          const enabled = Boolean(poiSources[source.id]) && !unavailable;
          return (
            <div className="layers-source-row" key={source.id} data-enabled={enabled || undefined}>
              <Icon name={placeSourceIcon(source.id)} size={20} className="layers-source-icon" />
              <span className="layers-source-name">{source.label}</span>
              {unavailable && <Chip label="bez klíče" />}
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
