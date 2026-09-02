import { registerLayer, registerLayerV2 } from "../registry";
import { createDataLayer, type DataLayerSpec } from "../dataLayer";
import type {
  FilterFacet,
  LayerAttribution,
  LayerCategory,
  LayerManifestV2
} from "@mapos/layer-sdk";

/**
 * Keyless data layers.
 *
 * Each one is a public API that needs no registration, fetched through our own API so the
 * upstream sees one polite, cached, identified caller instead of one per browser tab.
 */

function dataPlugin(args: {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: LayerCategory;
  spec: DataLayerSpec;
  filters?: FilterFacet[];
  defaultFilters?: Record<string, unknown>;
  attribution: LayerAttribution[];
  experimental?: boolean;
  /** Server capability gating the layer. Without it the layer isn't offered at all, which is
   *  kinder than showing a toggle that can only ever produce an error. */
  requiresCapability?: string;
}) {
  registerLayer({
    kind: "pins",
    manifest: {
      id: args.id,
      name: args.name,
      icon: args.icon,
      color: args.spec.color,
      description: args.description,
      category: args.category,
      experimental: args.experimental,
      requiresCapability: args.requiresCapability
    },
    filters: args.filters,
    defaultFilters: args.defaultFilters,
    create: (ctx) => createDataLayer(ctx.map, ctx.apiBaseUrl, ctx.layerId, args.spec),
    attribution: args.attribution
  });
}

function dataPluginV2(args: {
  manifest: LayerManifestV2;
  spec: DataLayerSpec;
  defaultFilters?: Record<string, unknown>;
}) {
  registerLayerV2({
    manifest: args.manifest,
    defaultFilters: args.defaultFilters,
    create: (ctx) => createDataLayer(ctx.map, ctx.apiBaseUrl, ctx.layerId, args.spec)
  });
}

dataPluginV2({
  manifest: {
    schema: "mapos.layer-manifest",
    schemaVersion: "2.0.0",
    sdkRange: "^2.0.0",
    id: "earthquakes",
    name: "Zemětřesení",
    icon: "🌋",
    color: "#ef4444",
    description: "Otřesy z globální sítě USGS, velikost bodu podle magnitudy",
    category: "environment",
    modes: ["discover"],
    geometryKinds: ["Point"],
    renderer: {
      type: "circles",
      style: {
        sizeProperty: "magnitude",
        minValue: 1,
        maxValue: 7,
        minRadius: 3,
        maxRadius: 26,
        labelFromZoom: 7
      }
    },
    source: {
      type: "server-adapter",
      adapterId: "usgs-earthquakes-v2",
      endpoint: "/api/v2/layers/earthquakes/features",
      method: "GET",
      requiresServerProxy: true
    },
    queryPolicy: {
      strategy: "viewport",
      maxResultsPerViewport: 100,
      debounceMs: 250,
      minZoom: 0,
      maxZoom: 24,
      searchHere: "after-pan",
      ranking: "time",
      cacheTtlSeconds: 600,
      staleWhileRevalidateSeconds: 600,
      cursorPagination: false
    },
    filters: [
      { id: "days", label: "Období", kind: "range", min: 1, max: 365, default: 30 },
      {
        id: "minMagnitude",
        label: "Min. magnituda",
        kind: "range",
        min: 0,
        max: 6,
        default: 1
      }
    ],
    detail: {
      tabs: [{ id: "overview", label: "Přehled", source: "canonical" }],
      fieldOrder: ["magnitude", "depthKm", "occurredAt", "urls"],
      aiEnrichment: "disabled"
    },
    actions: [{ id: "source", label: "Otevřít zdroj", kind: "open-url" }],
    attribution: [
      {
        label: "USGS Earthquake Hazards Program",
        url: "https://earthquake.usgs.gov/",
        license: "public domain",
        requiredOnMap: true,
        requiredOnExport: true
      }
    ],
    capabilities: ["query", "filter", "detail", "temporal", "export"],
    temporal: { enabled: true, cursorKinds: ["range"], timelinePriority: 10 },
    legend: {
      type: "numeric",
      title: "Magnituda zemětřesení",
      unit: "M",
      min: 1,
      max: 7,
      stops: [
        { value: 1, label: "1", color: "#fecaca" },
        { value: 3, label: "3", color: "#f87171" },
        { value: 5, label: "5", color: "#dc2626" },
        { value: 7, label: "7", color: "#7f1d1d" }
      ]
    },
    permissions: {
      defaultVisibility: "public",
      canCreate: false,
      canEdit: false,
      canComment: false,
      canExport: true,
      requiresAuth: false
    },
    ai: {
      discoverable: true,
      searchableFields: ["title", "magnitude"],
      permissionProjection: "public-features"
    },
    commerce: { access: "free", previewPolicy: "none", tipsEnabled: false },
    importExport: {
      importFormats: [],
      exportFormats: ["geojson", "json"],
      includeProviderFields: false
    },
    health: {
      checkEndpoint: "/api/health",
      expectedLatencyMs: 1200,
      failureMode: "empty-with-notice"
    },
    compatibility: {
      legacyLayerId: "earthquakes",
      legacyAdapter: "layerV2ToV1",
      migrationNotes: "The current circles renderer remains active during the v2 rollout."
    }
  },
  spec: {
    color: "#ef4444",
    contractVersion: 2,
    // Magnitude is logarithmic, so the radius range is wide on purpose: an M6 has to look
    // unmistakably different from the M2s around it.
    sizeBy: { property: "magnitude", min: 1, max: 7, minRadius: 3, maxRadius: 26 },
    labelFromZoom: 7
  },
  defaultFilters: { days: 30, minMagnitude: 1 }
});

dataPlugin({
  id: "inaturalist",
  name: "Pozorování přírody",
  icon: "🦋",
  description: "Nálezy rostlin a živočichů s fotkou z iNaturalistu",
  category: "environment",
  spec: { color: "#16a34a" },
  filters: [
    {
      id: "taxon",
      label: "Skupina",
      kind: "multi-select",
      options: [
        { id: "Aves", label: "Ptáci" },
        { id: "Insecta", label: "Hmyz" },
        { id: "Plantae", label: "Rostliny" },
        { id: "Fungi", label: "Houby" },
        { id: "Mammalia", label: "Savci" },
        { id: "Amphibia", label: "Obojživelníci" }
      ]
    }
  ],
  attribution: [{ label: "iNaturalist", url: "https://www.inaturalist.org/", license: "CC-BY-NC" }]
});

dataPlugin({
  id: "gbif",
  name: "Biodiverzita (GBIF)",
  icon: "🔬",
  description: "Historické i současné nálezy druhů z muzejních a vědeckých sbírek",
  category: "environment",
  spec: { color: "#0d9488" },
  attribution: [{ label: "GBIF", url: "https://www.gbif.org/", license: "CC-BY-4.0" }]
});

dataPlugin({
  id: "air-quality",
  name: "Kvalita ovzduší",
  icon: "💨",
  description: "Měření prachových částic z občanské sítě Sensor.Community",
  category: "environment",
  spec: {
    color: "#a855f7",
    sizeBy: { property: "pm25", min: 0, max: 60, minRadius: 4, maxRadius: 18 },
    labelFromZoom: 12
  },
  attribution: [
    { label: "Sensor.Community", url: "https://sensor.community/", license: "ODbL-1.0" }
  ]
});

dataPlugin({
  id: "commons-photos",
  name: "Fotky z Commons",
  icon: "📷",
  description: "Volně licencované fotografie míst z Wikimedia Commons",
  category: "community",
  spec: { color: "#f59e0b", labelFromZoom: 15 },
  attribution: [
    {
      label: "Wikimedia Commons",
      url: "https://commons.wikimedia.org/",
      license: "CC / public domain"
    }
  ]
});

dataPlugin({
  id: "refuge-restrooms",
  name: "Bezpečné toalety",
  icon: "🚻",
  description: "Bezbariérové a genderově neutrální toalety z Refuge Restrooms",
  category: "community",
  spec: { color: "#0ea5e9", labelFromZoom: 15 },
  filters: [
    { id: "accessible", label: "Bezbariérové", kind: "toggle" },
    { id: "unisex", label: "Genderově neutrální", kind: "toggle" }
  ],
  attribution: [
    {
      label: "Refuge Restrooms",
      url: "https://www.refugerestrooms.org/",
      license: "Refuge Restrooms open-data terms"
    }
  ]
});

// --- Layers that need a free API key. Hidden unless the server reports the capability. ---

dataPlugin({
  id: "charging-stations",
  name: "Nabíjecí stanice",
  icon: "🔌",
  description: "Nabíječky pro elektromobily s výkonem a typem konektoru (OpenChargeMap)",
  category: "transport",
  requiresCapability: "ocm",
  spec: {
    color: "#14b8a6",
    sizeBy: { property: "powerKw", min: 3, max: 350, minRadius: 4, maxRadius: 14 },
    labelFromZoom: 14
  },
  attribution: [
    { label: "Open Charge Map", url: "https://openchargemap.org/", license: "ODbL-1.0" }
  ]
});

dataPlugin({
  id: "mapillary",
  name: "Snímky ulic",
  icon: "🛣️",
  description: "Fotografie z úrovně ulice nasnímané komunitou (Mapillary)",
  category: "community",
  requiresCapability: "mapillary",
  spec: { color: "#22d3ee" },
  attribution: [{ label: "Mapillary", url: "https://www.mapillary.com/", license: "CC-BY-SA-4.0" }]
});

dataPlugin({
  id: "active-fires",
  name: "Aktivní požáry",
  icon: "🔥",
  description: "Detekce požárů ze satelitů VIIRS v posledních dnech (NASA FIRMS)",
  category: "environment",
  requiresCapability: "firms",
  spec: {
    color: "#f97316",
    sizeBy: { property: "brightness", min: 290, max: 400, minRadius: 4, maxRadius: 16 }
  },
  filters: [{ id: "days", label: "Posledních dní", kind: "range", min: 1, max: 7, default: 1 }],
  defaultFilters: { days: 1 },
  attribution: [
    { label: "NASA FIRMS", url: "https://firms.modaps.eosdis.nasa.gov/", license: "public domain" }
  ]
});

dataPlugin({
  id: "openaq",
  name: "Měřicí stanice ovzduší",
  icon: "🏭",
  description: "Referenční stanice kvality ovzduší z celého světa (OpenAQ)",
  category: "environment",
  requiresCapability: "openaq",
  spec: { color: "#8b5cf6", labelFromZoom: 12 },
  attribution: [{ label: "OpenAQ", url: "https://openaq.org/", license: "CC-BY-4.0" }]
});

dataPlugin({
  id: "ebird",
  name: "Pozorování ptáků",
  icon: "🦅",
  description: "Nedávná pozorování ptáků z databáze eBird",
  category: "environment",
  requiresCapability: "ebird",
  spec: { color: "#ca8a04", labelFromZoom: 13 },
  filters: [{ id: "days", label: "Posledních dní", kind: "range", min: 1, max: 30, default: 7 }],
  defaultFilters: { days: 7 },
  attribution: [
    { label: "eBird / Cornell Lab", url: "https://ebird.org/", license: "eBird API Terms" }
  ]
});

dataPluginV2({
  manifest: {
    schema: "mapos.layer-manifest",
    schemaVersion: "2.0.0",
    sdkRange: "^2.0.0",
    id: "events",
    name: "Události",
    icon: "🎫",
    color: "#e11d48",
    description: "Časové události s kanonickým detailem a zachovanými zdroji",
    category: "events",
    modes: ["discover"],
    geometryKinds: ["Point"],
    renderer: {
      type: "circles",
      style: { colorProperty: "status", labelFromZoom: 12 }
    },
    source: {
      type: "server-adapter",
      adapterId: "canonical-events-v2",
      endpoint: "/v2/layers/events/features",
      method: "GET",
      requiresServerProxy: true
    },
    queryPolicy: {
      strategy: "viewport",
      maxResultsPerViewport: 100,
      debounceMs: 250,
      minZoom: 0,
      maxZoom: 24,
      searchHere: "after-pan",
      ranking: "time",
      cacheTtlSeconds: 60,
      staleWhileRevalidateSeconds: 300,
      cursorPagination: true
    },
    filters: [
      { id: "category", label: "Kategorie", kind: "single-select", providerField: "categories" },
      {
        id: "status",
        label: "Stav",
        kind: "single-select",
        providerField: "status",
        options: [
          { id: "scheduled", label: "Naplánováno" },
          { id: "rescheduled", label: "Přesunuto" },
          { id: "postponed", label: "Odloženo" },
          { id: "cancelled", label: "Zrušeno" },
          { id: "completed", label: "Proběhlo" }
        ]
      },
      { id: "free", label: "Zdarma", kind: "toggle", providerField: "price.free" },
      { id: "venue", label: "Místo", kind: "text", providerField: "venue.name" },
      { id: "source", label: "Zdroj", kind: "single-select", providerField: "sources.providerId" },
      { id: "eventRange", label: "Období", kind: "date-range" }
    ],
    detail: {
      tabs: [
        { id: "overview", label: "Přehled", source: "canonical" },
        { id: "tickets", label: "Vstupenky", source: "provider", providerId: "ticketmaster" }
      ],
      fieldOrder: [
        "status",
        "schedule.startsAt",
        "schedule.endsAt",
        "schedule.timezone",
        "venue",
        "performers",
        "organizer",
        "price",
        "ticketOffers",
        "sources"
      ],
      aiEnrichment: "disabled"
    },
    actions: [
      { id: "save", label: "Uložit", kind: "save" },
      { id: "share", label: "Sdílet", kind: "share" },
      { id: "add-to-plan", label: "Přidat do plánu", kind: "custom" },
      { id: "provider", label: "Otevřít poskytovatele", kind: "open-url" }
    ],
    attribution: [
      {
        label: "Ticketmaster Discovery",
        url: "https://developer.ticketmaster.com/",
        license: "Ticketmaster Developer Agreement",
        requiredOnMap: true,
        requiredOnExport: true
      }
    ],
    capabilities: ["query", "filter", "detail", "temporal", "export", "routing"],
    temporal: {
      enabled: true,
      cursorKinds: ["range"],
      defaultRangeHours: 168,
      timelinePriority: 40
    },
    legend: {
      type: "categorical",
      title: "Stav události",
      items: [
        { value: "scheduled", label: "Naplánováno", color: "#e11d48" },
        { value: "rescheduled", label: "Přesunuto", color: "#7c3aed" },
        { value: "postponed", label: "Odloženo", color: "#d97706" },
        { value: "cancelled", label: "Zrušeno", color: "#57534e" },
        { value: "completed", label: "Proběhlo", color: "#64748b" }
      ]
    },
    permissions: {
      defaultVisibility: "public",
      canCreate: false,
      canEdit: false,
      canComment: false,
      canExport: true,
      requiresAuth: false
    },
    ai: {
      discoverable: true,
      searchableFields: ["title", "venue.name", "performers.name", "organizer.name"],
      permissionProjection: "public-features"
    },
    commerce: { access: "free", previewPolicy: "none", tipsEnabled: false },
    importExport: {
      importFormats: [],
      exportFormats: ["geojson", "json"],
      includeProviderFields: true
    },
    health: {
      checkEndpoint: "/health",
      expectedLatencyMs: 1_500,
      failureMode: "stale-cache"
    },
    compatibility: {
      legacyLayerId: "events",
      legacyAdapter: "layerV2ToV1",
      migrationNotes: "The old events layer id and URL state remain compatible."
    }
  },
  spec: {
    color: "#e11d48",
    contractVersion: 2,
    labelFromZoom: 12,
    colorBy: {
      property: "status",
      values: {
        scheduled: "#e11d48",
        rescheduled: "#7c3aed",
        postponed: "#d97706",
        cancelled: "#57534e",
        completed: "#64748b",
        unknown: "#78716c"
      }
    }
  }
});

dataPlugin({
  id: "shared-mobility",
  name: "Sdílená kola a koloběžky",
  icon: "🛴",
  description: "Stanice bikesharingu z otevřených GBFS feedů operátorů",
  category: "transport",
  // The feed registry is fetched per country and coverage is learnt as it goes, so a first
  // visit to a city can come back empty until the right operator has been seen once.
  experimental: true,
  spec: { color: "#22c55e", labelFromZoom: 14 },
  attribution: [
    {
      label: "GBFS operátoři",
      url: "https://github.com/MobilityData/gbfs",
      license: "GBFS feed-specific operator terms"
    }
  ]
});
