/**
 * `@mapos/adapter-sdk` — turning a URL somebody pasted into a MapOS layer.
 *
 * The package holds the contract and the protocol adapters, and no fetch stack: an adapter is
 * handed an `AdapterIo` so that every request it makes goes through the server's guarded client.
 * It also holds no MapLibre, so the same adapter describes a layer on the server and the client
 * renders it from the manifest.
 */
export * from "./contract.js";
export * from "./registry.js";
export * from "./arcgis/arcgisAdapter.js";
export * from "./arcgis/esriJson.js";
export * from "./builtins.js";
export * from "./pmtiles/pmtilesAdapter.js";
export * from "./stat/statSeries.js";
export * from "./stat/statDatasets.js";
export * from "./stat/statCoverage.js";
export * from "./wms/capabilities.js";
export * from "./wms/wmsAdapter.js";

export * from "./wmts/wmtsAdapter.js";

export * from "./stat/statIndicators.js";

export * from "./elections/electionResult.js";
