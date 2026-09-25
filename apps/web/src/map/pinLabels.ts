import type maplibregl from "maplibre-gl";

/** What providers write when a place has no name. Drawn on the map it is pure noise: a dense
 *  street ends up labelled "Bez názvu" a dozen times. The detail sheet still shows it. */
export const PLACEHOLDER_PIN_NAMES = ["", "Bez názvu", "Unnamed", "Untitled", "Neznámé místo"];

/** Only features with a real name get a map label. */
export const NAMED_PIN_FILTER: maplibregl.ExpressionSpecification = [
  "all",
  ["has", "name"],
  ["!", ["in", ["to-string", ["get", "name"]], ["literal", PLACEHOLDER_PIN_NAMES]]]
];

/** Labels never cover a pin and give way to each other, so a dense view keeps every pin visible
 *  and drops only the text that does not fit. */
export const PIN_LABEL_LAYOUT = {
  "text-optional": true,
  "text-allow-overlap": false,
  "text-padding": 2
} as const;

/** Unclustered points that carry a drawable name. */
export function namedPointFilter(clustered: boolean): maplibregl.FilterSpecification {
  return clustered ? ["all", ["!", ["has", "point_count"]], NAMED_PIN_FILTER] : NAMED_PIN_FILTER;
}
