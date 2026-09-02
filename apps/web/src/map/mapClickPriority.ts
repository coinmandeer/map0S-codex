export type MapClickTarget<TPin, TRegion> =
  { kind: "pin"; feature: TPin } | { kind: "region"; feature: TRegion } | null;

/** POIs and user pins stay interactive even when an administrative polygon covers the map. */
export function chooseMapClickTarget<TPin, TRegion>(
  pinHits: readonly TPin[],
  regionHits: readonly TRegion[]
): MapClickTarget<TPin, TRegion> {
  if (pinHits[0] !== undefined) return { kind: "pin", feature: pinHits[0] };
  if (regionHits[0] !== undefined) return { kind: "region", feature: regionHits[0] };
  return null;
}
