/**
 * The `near` bias a place search sends: the centre of the map on screen, so "Náměstí Míru" typed
 * over Brno finds the one in Brno first. Coarse (two decimals, about a kilometre) and only once
 * the map shows a region rather than a continent, where its centre means nothing.
 */
export function geocodeNearParam(
  view: { lng: number; lat: number; zoom: number } | null | undefined
): string {
  if (!view || !Number.isFinite(view.lng) || !Number.isFinite(view.lat) || !(view.zoom >= 5))
    return "";
  return `&near=${view.lng.toFixed(2)},${view.lat.toFixed(2)}`;
}
