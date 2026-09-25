import { arcgisAdapter } from "./arcgis/arcgisAdapter.js";
import { pmtilesAdapter } from "./pmtiles/pmtilesAdapter.js";
import { createAdapterRegistry, type AdapterRegistry } from "./registry.js";
import { wmtsAdapter } from "./wmts/wmtsAdapter.js";
import { wmsAdapter } from "./wms/wmsAdapter.js";

/**
 * The adapters MapOS ships with.
 *
 * Order is only a tie-break — `detectSource` ranks by each adapter's own confidence — but it is
 * not arbitrary: PMTiles first because its match is a file, then ArcGIS whose service type is in
 * the path, then WMS, which is the one that has to guess from an endpoint name.
 */
export const BUILT_IN_ADAPTERS = [pmtilesAdapter, arcgisAdapter, wmtsAdapter, wmsAdapter] as const;

/** A fresh registry per caller, so registering an adapter in a test cannot leak into the app. */
export function createBuiltInAdapterRegistry(): AdapterRegistry {
  return createAdapterRegistry(BUILT_IN_ADAPTERS);
}
