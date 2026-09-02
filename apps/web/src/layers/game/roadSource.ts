import type { LayerAttribution } from "@mapos/layer-sdk";

/**
 * The game mounts this source only when the active basemap has no walkable vector geometry.
 * Keeping its URL and rights together prevents a hidden cartography dependency from bypassing
 * the release inventory.
 */
export const GAME_ROAD_SOURCE = {
  tileJsonUrl: "https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json",
  attribution: [
    {
      label: "© OpenStreetMap přispěvatelé",
      url: "https://www.openstreetmap.org/copyright",
      license: "ODbL-1.0"
    },
    {
      label: "© CARTO",
      url: "https://carto.com/attributions",
      license: "CARTO Maps API Terms"
    }
  ] satisfies LayerAttribution[]
};
