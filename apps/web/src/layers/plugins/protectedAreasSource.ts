import { wmsAdapter, type SourceProbe } from "@mapos/adapter-sdk";

/**
 * The WMS facts behind the Natura 2000 layer, kept apart from the layer itself so they can be
 * checked without loading MapLibre.
 *
 * This is the first consumer of `wmsAdapter` (§C2): the GetMap template comes from the adapter
 * rather than from a `URLSearchParams` built by hand here. `PROBE` is what
 * `wmsAdapter.probe(WMS)` returns, transcribed from the service's capabilities so a built-in
 * layer costs no GetCapabilities round trip at startup — but it flows through the same
 * `tileTemplate` a pasted URL does, so the two paths cannot drift apart.
 */
export const NATURA_WMS =
  "https://bio.discomap.eea.europa.eu/arcgis/services/ProtectedSites/Natura2000Sites/MapServer/WMSServer";

/** WMS layer ids, as published in the service's capabilities. */
export const BIRDS = "1";
export const HABITATS = "2";

const PROBE: SourceProbe = {
  adapterId: wmsAdapter.id,
  kind: "wms",
  delivery: "tiles",
  endpoint: NATURA_WMS,
  title: "Natura2000Sites",
  version: "1.3.0",
  sublayers: [
    { id: BIRDS, title: "Ptačí oblasti", selectable: true },
    { id: HABITATS, title: "Přírodní stanoviště", selectable: true }
  ],
  formats: ["image/png", "image/jpeg", "image/gif"],
  crs: ["EPSG:3857", "EPSG:4326"]
};

/** `wmsLayers` is painted back to front, so the smaller bird areas stay visible over the
 *  habitat sites. */
export function naturaGetMapUrl(wmsLayers: string[]): string {
  return wmsAdapter.tileTemplate!({
    probe: PROBE,
    layerId: "natura2000",
    sublayerIds: wmsLayers
  });
}
