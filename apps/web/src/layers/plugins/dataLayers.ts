import { registerLayer } from "../registry";
import { createDataLayer, type DataLayerSpec } from "../dataLayer";
import type { FilterFacet, LayerAttribution, LayerCategory } from "@mapos/layer-sdk";

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

dataPlugin({
  id: "earthquakes",
  name: "Zemětřesení",
  icon: "🌋",
  description: "Otřesy z globální sítě USGS, velikost bodu podle magnitudy",
  category: "environment",
  spec: {
    color: "#ef4444",
    // Magnitude is logarithmic, so the radius range is wide on purpose: an M6 has to look
    // unmistakably different from the M2s around it.
    sizeBy: { property: "magnitude", min: 1, max: 7, minRadius: 3, maxRadius: 26 },
    labelFromZoom: 7
  },
  filters: [
    {
      id: "days",
      label: "Období",
      kind: "range",
      min: 1,
      max: 365,
      default: 30
    },
    {
      id: "minMagnitude",
      label: "Min. magnituda",
      kind: "range",
      min: 0,
      max: 6,
      default: 1
    }
  ],
  defaultFilters: { days: 30, minMagnitude: 1 },
  attribution: [
    {
      label: "USGS Earthquake Hazards Program",
      url: "https://earthquake.usgs.gov/",
      license: "public domain"
    }
  ]
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
  attribution: [{ label: "Refuge Restrooms", url: "https://www.refugerestrooms.org/" }]
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
  attribution: [{ label: "eBird / Cornell Lab", url: "https://ebird.org/" }]
});

dataPlugin({
  id: "events",
  name: "Události",
  icon: "🎫",
  description: "Koncerty, divadlo a sport ve zvoleném období (Ticketmaster)",
  category: "community",
  requiresCapability: "ticketmaster",
  spec: { color: "#e11d48", labelFromZoom: 12 },
  // The from/to filters are written by the timeline above the map rather than by a menu, so
  // they are declared without facets: the layer reads them, nothing else offers to set them.
  defaultFilters: { from: null, to: null },
  attribution: [{ label: "Ticketmaster Discovery", url: "https://developer.ticketmaster.com/" }]
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
  attribution: [{ label: "GBFS operátoři", url: "https://github.com/MobilityData/gbfs" }]
});
