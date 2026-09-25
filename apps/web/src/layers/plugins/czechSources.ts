import { wmsAdapter, type SourceProbe } from "@mapos/adapter-sdk";

import { CZECH_BOUNDS, CZECH_SOURCES, type CzechLayerDefinition } from "@mapos/layer-sdk";
export {
  CZECH_BOUNDS,
  CZECH_SOURCES,
  CZECH_SUBGROUPS,
  CZECH_LAYERS,
  type CzechLayerDefinition
} from "@mapos/layer-sdk";

export function czechTileUrl(
  def: CzechLayerDefinition,
  inverse = false,
  selection = def.layers
): string {
  const layers = inverse && def.inverse ? def.inverse : selection;
  const probe: SourceProbe = {
    adapterId: "wms",
    kind: "wms",
    delivery: "tiles",
    title: def.cs,
    endpoint: CZECH_SOURCES[def.source].endpoint,
    version: "1.3.0",
    formats: ["image/png"],
    crs: ["EPSG:3857"],
    sublayers: layers.map((id) => ({ id, title: id, selectable: true }))
  };
  return wmsAdapter.tileTemplate!({ probe, layerId: def.id, sublayerIds: layers });
}

/** This is a coarse request bound, not a claim of complete coverage inside it. */
export function inCzechBounds(lng: number, lat: number): boolean {
  return (
    lng >= CZECH_BOUNDS[0] &&
    lng <= CZECH_BOUNDS[2] &&
    lat >= CZECH_BOUNDS[1] &&
    lat <= CZECH_BOUNDS[3]
  );
}
