import { loadAllSavedPlaces, savedPlacesToFeatureCollection } from "../lib/savedPlaces";
import { createPinsLayerHandle } from "./pinsLayer";
import { registerLayerV2 } from "./registry";

registerLayerV2({
  manifest: {
    schema: "mapos.layer-manifest",
    schemaVersion: "2.0.0",
    sdkRange: "^2.0.0",
    id: "my-saved-places",
    name: "Moje uložená místa",
    icon: "★",
    color: "#0f766e",
    description: "Všechna místa uložená v osobním profilu, nezávisle na výřezu mapy",
    category: "user",
    modes: ["personal"],
    geometryKinds: ["Point"],
    renderer: {
      type: "symbols",
      cluster: true,
      clusterMaxZoom: 5,
      clusterRadiusPx: 42,
      style: { ownershipCue: "personal" }
    },
    source: {
      type: "user-data",
      adapterId: "saved-places-v2",
      endpoint: "/api/v2/me/saved-places",
      method: "GET",
      requiresServerProxy: true
    },
    queryPolicy: {
      strategy: "global",
      maxResultsPerViewport: 100,
      searchHere: "never",
      cacheTtlSeconds: 600,
      staleWhileRevalidateSeconds: 600,
      cursorPagination: true
    },
    detail: {
      tabs: [{ id: "overview", label: "Přehled", source: "canonical" }],
      fieldOrder: ["title", "category", "note", "tags", "collection"],
      aiEnrichment: "disabled"
    },
    actions: [
      { id: "route", label: "Naplánovat trasu", kind: "route-to" },
      { id: "share", label: "Sdílet", kind: "share" }
    ],
    attribution: [
      { label: "Soukromá data uživatele MapOS", license: "private owner-controlled data" }
    ],
    capabilities: ["query", "filter", "detail", "export"],
    permissions: {
      defaultVisibility: "private",
      canCreate: true,
      canEdit: true,
      canComment: false,
      canExport: true,
      requiresAuth: true
    },
    ai: {
      discoverable: false,
      searchableFields: ["title", "category", "tags"],
      tools: ["list-saved-places"],
      permissionProjection: "owner-private"
    },
    commerce: { access: "free", previewPolicy: "none", tipsEnabled: false },
    importExport: {
      importFormats: ["geojson", "gpx", "kml", "csv", "json", "mapos-package"],
      exportFormats: ["geojson", "gpx", "kml", "csv", "json", "mapos-package"],
      includeProviderFields: false
    },
    health: { failureMode: "empty-with-notice" },
    compatibility: {
      legacyLayerId: "my-saved-places",
      legacyAdapter: "layerV2ToV1",
      migrationNotes: "Primary Personal layer while the legacy shell still uses mode aliases."
    }
  },
  primaryForModes: ["mine"],
  viewportCost: "cheap",
  create: (ctx) =>
    createPinsLayerHandle(
      ctx.map,
      ctx.apiBaseUrl,
      ctx.layerId,
      ctx.color,
      async (_bbox, _filters, signal) =>
        savedPlacesToFeatureCollection(await loadAllSavedPlaces(signal)),
      { personal: true }
    )
});
