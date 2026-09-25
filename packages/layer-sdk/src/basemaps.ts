import type { LayerAttribution } from "./types.js";

/**
 * The catalogue of map backgrounds.
 *
 * A basemap is deliberately not a layer plugin: exactly one can be active, it defines the whole
 * MapLibre style rather than adding to it, and everything else in the engine draws on top of it.
 * Keeping the catalogue in the SDK means the API can answer "which of these can I actually
 * serve?" from the same list the picker renders.
 *
 * Two ways a basemap reaches the browser:
 *
 * - `tiles` / `styleUrl` — the upstream is public and needs no key, so the browser fetches it
 *   directly and our server never sees the traffic.
 * - `proxy` — the upstream needs a key (or, for Google, a session token), so tiles go through
 *   `GET /basemap/:provider/:mapset/:z/:x/:y` and the key stays on the server.
 */

/** `historic` and `national` have no keyless members yet; they exist so the historical imagery
 *  and the national geoportals land in a named category instead of being appended to
 *  "Základní". The picker skips a group with nothing in it. */
export type BasemapGroup = "street" | "outdoor" | "satellite" | "terrain" | "historic" | "national";

export const BASEMAP_GROUP_LABELS: Record<BasemapGroup, string> = {
  street: "Základní",
  outdoor: "Turistické a outdoor",
  satellite: "Letecké a satelitní",
  terrain: "Terén a reliéf",
  historic: "Historické",
  national: "Národní geoportály"
};

export const BASEMAP_GROUP_LABELS_EN: Record<BasemapGroup, string> = {
  street: "Standard",
  outdoor: "Outdoor & hiking",
  satellite: "Aerial & satellite",
  terrain: "Terrain & relief",
  historic: "Historic",
  national: "National geoportals"
};

export interface BasemapDefinition {
  id: string;
  label: string;
  group: BasemapGroup;
  /** One line in the picker: what this background is good for, not what technology it uses. */
  hint: string;
  /** Vector styles can carry 3D buildings and follow the theme; rasters cannot. */
  kind: "vector" | "raster";
  /** Keyless vector style, fetched by MapLibre itself. */
  styleUrl?: string;
  /** Keyless raster tiles. */
  tiles?: string[];
  /** Keyed upstream, served through our tile proxy. */
  proxy?: { provider: string; mapset: string };
  /** Capability flag the server must report before this is offered. */
  requiresCapability?: string;
  attribution: LayerAttribution[];
  maxzoom?: number;
  minzoom?: number;
  bounds?: [number, number, number, number];
  tileSize?: number;
  /** Imagery with no labels — pairs with a label overlay so places stay findable. */
  imagery?: boolean;
  /** Dark counterpart, used when the theme is dark and this one is a light design. */
  darkVariantId?: string;
  /** Something the user should know before switching, e.g. patchy zoom coverage. */
  note?: string;
  /** Illustration for the picker card. Defaults by convention to `/basemaps/<id>.webp`, which
   *  `scripts/render-basemap-thumbs.mjs` writes; set it to override, e.g. where an upstream's
   *  terms do not allow republishing a rendered sample. */
  thumbnail?: string;
  /** Vector schema whose building polygons can be extruded. Absent means no 3D. */
  buildingSourceLayer?: string;
}

/** Transparent label layers, drawn over imagery. Not selectable on their own. */
export interface LabelOverlayDefinition {
  id: string;
  label: string;
  tiles?: string[];
  proxy?: { provider: string; mapset: string };
  requiresCapability?: string;
  attribution: LayerAttribution[];
  /** Dark-themed variant of the same overlay. */
  darkTiles?: string[];
}

const OSM: LayerAttribution = {
  label: "© OpenStreetMap přispěvatelé",
  url: "https://www.openstreetmap.org/copyright",
  license: "ODbL-1.0"
};

export const BASEMAPS: BasemapDefinition[] = [
  {
    id: "cuzk-ortofoto",
    label: "Ortofoto ČR — ČÚZK",
    group: "national",
    kind: "raster",
    hint: "Oficiální letecký podklad České republiky",
    imagery: true,
    tiles: ["https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}"],
    bounds: [12.09, 48.55, 18.87, 51.06],
    maxzoom: 19,
    tileSize: 256,
    note: "Pokrytí pouze ČR. Mimo území zvolte jiný podklad; datum snímkování se liší podle místa.",
    thumbnail:
      "https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/11/693/1106",
    attribution: [
      {
        label: "© ČÚZK — Ortofoto ČR",
        url: "https://geoportal.cuzk.gov.cz/",
        license: "Podmínky užití dat a služeb Zeměměřického úřadu"
      }
    ]
  },
  // ---- Keyless: everything below works in a fresh clone -------------------------------
  {
    id: "carto-voyager",
    label: "CARTO Voyager",
    group: "street",
    hint: "Výchozí čitelný podklad, tlumené barvy",
    kind: "vector",
    styleUrl: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    darkVariantId: "carto-dark",
    buildingSourceLayer: "building",
    attribution: [
      OSM,
      {
        label: "© CARTO",
        url: "https://carto.com/attributions",
        license: "CARTO Maps API Terms"
      }
    ]
  },
  {
    id: "carto-dark",
    label: "CARTO Dark Matter",
    group: "street",
    hint: "Tmavý podklad, pod který vyniknou barevné vrstvy",
    kind: "vector",
    styleUrl: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    buildingSourceLayer: "building",
    attribution: [
      OSM,
      {
        label: "© CARTO",
        url: "https://carto.com/attributions",
        license: "CARTO Maps API Terms"
      }
    ]
  },
  {
    id: "openfreemap-liberty",
    label: "OpenFreeMap Liberty",
    group: "street",
    hint: "Detailní OSM styl bez klíče a bez limitů",
    kind: "vector",
    styleUrl: "https://tiles.openfreemap.org/styles/liberty",
    buildingSourceLayer: "building",
    attribution: [
      OSM,
      { label: "OpenFreeMap", url: "https://openfreemap.org/", license: "OpenMapTiles" }
    ]
  },
  {
    id: "openfreemap-positron",
    label: "OpenFreeMap Positron",
    group: "street",
    hint: "Světlý minimalistický podklad pro datové vrstvy",
    kind: "vector",
    styleUrl: "https://tiles.openfreemap.org/styles/positron",
    buildingSourceLayer: "building",
    attribution: [
      OSM,
      { label: "OpenFreeMap", url: "https://openfreemap.org/", license: "OpenMapTiles" }
    ]
  },
  {
    id: "openfreemap-dark",
    label: "OpenFreeMap Dark",
    group: "street",
    hint: "Dark keyless vector style — the night mode that still draws 3D buildings",
    kind: "vector",
    styleUrl: "https://tiles.openfreemap.org/styles/dark",
    buildingSourceLayer: "building",
    attribution: [
      OSM,
      { label: "OpenFreeMap", url: "https://openfreemap.org/", license: "OpenMapTiles" }
    ]
  },
  {
    id: "osm-france",
    label: "OSM France",
    group: "street",
    hint: "The French community's OSM style — dense local detail, keyless",
    kind: "raster",
    tiles: [
      "https://a.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png"
    ],
    maxzoom: 20,
    attribution: [
      OSM,
      {
        label: "OpenStreetMap France",
        url: "https://www.openstreetmap.fr/",
        license: "CC-BY-SA-2.0"
      }
    ]
  },
  {
    id: "opnvkarte",
    label: "ÖPNV-Karte",
    group: "street",
    hint: "Public transport map: bus, tram, rail and ferry lines",
    kind: "raster",
    tiles: ["https://tileserver.memomaps.de/tilegen/{z}/{x}/{y}.png"],
    maxzoom: 18,
    attribution: [
      OSM,
      { label: "ÖPNVKarte", url: "https://www.öpnvkarte.de/", license: "CC-BY-SA-2.0" }
    ]
  },
  {
    id: "osm-carto",
    label: "OpenStreetMap",
    group: "street",
    hint: "Klasická OSM mapa tak, jak ji zná osm.org",
    kind: "raster",
    tiles: [
      "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
    ],
    maxzoom: 19,
    note: "Dlaždice provozuje OSMF z darů — vhodné na testování, ne na provoz s tisíci uživateli.",
    attribution: [OSM]
  },
  {
    id: "opentopomap",
    label: "OpenTopoMap",
    group: "terrain",
    hint: "Vrstevnice a stínovaný reliéf ve stylu turistické mapy",
    kind: "raster",
    tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png"],
    maxzoom: 17,
    attribution: [
      OSM,
      { label: "OpenTopoMap", url: "https://opentopomap.org/", license: "CC-BY-SA-3.0" }
    ]
  },
  {
    id: "eox-s2cloudless",
    label: "Sentinel-2 bez mraků",
    group: "satellite",
    hint: "Celoevropská satelitní mozaika z Copernicu, zdarma a bez klíče",
    kind: "raster",
    tiles: [
      "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg"
    ],
    maxzoom: 15,
    imagery: true,
    note: "Rozlišení 10 m — skvělé na krajinu, na jednotlivé domy je málo.",
    attribution: [
      {
        label: "Sentinel-2 cloudless (EOX)",
        url: "https://s2maps.eu/",
        license: "CC-BY-4.0"
      }
    ]
  },
  {
    id: "esri-imagery",
    label: "Esri World Imagery",
    group: "satellite",
    hint: "Ostré letecké snímky s pokrytím do velkých zoomů",
    kind: "raster",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    ],
    maxzoom: 19,
    imagery: true,
    note: "Veřejná služba Esri. Pro provoz je potřeba účet ArcGIS Location Platform (zdarma 2 M dlaždic/měsíc).",
    attribution: [
      {
        label: "Esri, Maxar, Earthstar Geographics",
        url: "https://www.esri.com/en-us/legal/terms/full-master-agreement",
        license: "Esri Master Agreement"
      }
    ]
  },
  {
    id: "gibs-viirs",
    label: "NASA dnešní snímek",
    group: "satellite",
    hint: "Včerejší až dnešní pohled ze satelitu VIIRS, celá planeta",
    kind: "raster",
    tiles: [
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg"
    ],
    maxzoom: 8,
    imagery: true,
    note: "Denní mozaika v nízkém rozlišení — na počasí a požáry, ne na navigaci.",
    attribution: [
      { label: "NASA GIBS / EOSDIS", url: "https://earthdata.nasa.gov/", license: "public domain" }
    ]
  },
  {
    // Full cartography belongs to backgrounds; the separate overlay uses CyclOSM Lite.
    id: "cyclosm",
    label: "CyclOSM — plná cyklistická mapa",
    group: "outdoor",
    hint: "Plný podklad: cyklostezky, sítě tras, povrchy a služby pro kola",
    kind: "raster",
    tiles: [
      "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
      "https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
      "https://c.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"
    ],
    maxzoom: 20,
    attribution: [
      OSM,
      { label: "CyclOSM", url: "https://www.cyclosm.org/", license: "CC-BY-SA-2.0" }
    ]
  },
  {
    id: "osm-hot",
    label: "OSM Humanitarian",
    group: "street",
    hint: "High-contrast OSM style built for field and crisis mapping",
    kind: "raster",
    tiles: [
      "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"
    ],
    maxzoom: 19,
    attribution: [
      OSM,
      {
        label: "Tiles: OpenStreetMap France",
        url: "https://www.openstreetmap.fr/usage/",
        license: "OpenStreetMap France usage policy"
      },
      {
        label: "Humanitarian OpenStreetMap Team",
        url: "https://www.hotosm.org/",
        license: "CC-BY-SA-2.0"
      }
    ]
  },
  {
    id: "carto-positron",
    label: "CARTO Positron",
    group: "street",
    hint: "Almost colourless background — data layers carry all the colour",
    kind: "vector",
    styleUrl: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    darkVariantId: "carto-dark",
    buildingSourceLayer: "building",
    attribution: [
      OSM,
      { label: "© CARTO", url: "https://carto.com/attributions", license: "CARTO Maps API Terms" }
    ]
  },
  {
    id: "esri-topo",
    label: "Esri World Topo",
    group: "terrain",
    hint: "Terrain, land cover and place names in one readable sheet",
    kind: "raster",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
    ],
    maxzoom: 19,
    attribution: [
      {
        label: "Esri, HERE, Garmin, FAO, NOAA",
        url: "https://www.esri.com/en-us/legal/terms/full-master-agreement",
        license: "Esri Master Agreement"
      }
    ]
  },
  {
    id: "eox-terrain",
    label: "EOX Terrain",
    group: "terrain",
    hint: "Reliéf a povrch bez silnic, dobré pod herní a datové vrstvy",
    kind: "raster",
    tiles: [
      "https://tiles.maps.eox.at/wmts/1.0.0/terrain-light_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg"
    ],
    maxzoom: 13,
    attribution: [
      { label: "Terrain Light (EOX)", url: "https://maps.eox.at/", license: "CC-BY-SA-4.0" },
      OSM
    ]
  },

  // ---- Mapy.com: one key, five very different backgrounds -----------------------------
  {
    id: "mapy-outdoor",
    label: "Mapy.com Turistická",
    group: "outdoor",
    hint: "Značené trasy, vrstevnice a turistická infrastruktura",
    kind: "raster",
    proxy: { provider: "mapy", mapset: "outdoor" },
    requiresCapability: "mapy",
    maxzoom: 19,
    attribution: [
      { label: "© Seznam.cz a.s.", url: "https://mapy.com/", license: "Mapy.com API Terms" }
    ]
  },
  {
    id: "mapy-basic",
    label: "Mapy.com Základní",
    group: "street",
    hint: "Městská mapa Mapy.com s detailními CZ/SK daty",
    kind: "raster",
    proxy: { provider: "mapy", mapset: "basic" },
    requiresCapability: "mapy",
    maxzoom: 19,
    attribution: [
      { label: "© Seznam.cz a.s.", url: "https://mapy.com/", license: "Mapy.com API Terms" }
    ]
  },
  {
    id: "mapy-winter",
    label: "Mapy.com Zimní",
    group: "outdoor",
    hint: "Sjezdovky, běžecké stopy a vleky",
    kind: "raster",
    proxy: { provider: "mapy", mapset: "winter" },
    requiresCapability: "mapy",
    maxzoom: 19,
    attribution: [
      { label: "© Seznam.cz a.s.", url: "https://mapy.com/", license: "Mapy.com API Terms" }
    ]
  },
  {
    id: "mapy-aerial",
    label: "Mapy.com Letecká",
    group: "satellite",
    hint: "Nejostřejší letecké snímky pro Česko a okolní země",
    kind: "raster",
    proxy: { provider: "mapy", mapset: "aerial" },
    requiresCapability: "mapy",
    maxzoom: 20,
    imagery: true,
    note: "Do zoomu 20 jen ČR, do 19 SK/AT/PL/SI/FR/CH a část Německa; jinde svět končí na 13.",
    attribution: [
      { label: "© Seznam.cz a.s.", url: "https://mapy.com/", license: "Mapy.com API Terms" }
    ]
  },

  // ---- Keyed providers, hidden until the deployment holds a key -----------------------
  {
    id: "google-roadmap",
    label: "Google Mapy",
    group: "street",
    hint: "Google silniční mapa přes Map Tiles API",
    kind: "raster",
    proxy: { provider: "google", mapset: "roadmap" },
    requiresCapability: "googleTiles",
    maxzoom: 22,
    tileSize: 256,
    attribution: [
      {
        label: "© Google",
        url: "https://developers.google.com/maps/terms",
        license: "Google Maps Platform Terms"
      }
    ]
  },
  {
    id: "google-satellite",
    label: "Google Satelitní",
    group: "satellite",
    hint: "Google satelitní podklad bez popisků",
    kind: "raster",
    proxy: { provider: "google", mapset: "satellite" },
    requiresCapability: "googleSatellite",
    maxzoom: 22,
    imagery: true,
    attribution: [
      {
        label: "© Google",
        url: "https://developers.google.com/maps/terms",
        license: "Google Maps Platform Terms"
      }
    ]
  },
  {
    id: "google-terrain",
    label: "Google Terén",
    group: "terrain",
    hint: "Google terénní podklad se stínovaným reliéfem",
    kind: "raster",
    proxy: { provider: "google", mapset: "terrain" },
    requiresCapability: "googleTiles",
    maxzoom: 22,
    attribution: [
      {
        label: "© Google",
        url: "https://developers.google.com/maps/terms",
        license: "Google Maps Platform Terms"
      }
    ]
  },
  {
    id: "here-explore",
    label: "HERE Explore",
    group: "street",
    hint: "HERE mapa s důrazem na dopravu a POI",
    kind: "raster",
    proxy: { provider: "here", mapset: "explore" },
    requiresCapability: "here",
    maxzoom: 20,
    attribution: [
      { label: "© HERE", url: "https://legal.here.com/terms", license: "HERE Service Terms" }
    ]
  },
  {
    id: "here-satellite",
    label: "HERE Satelitní",
    group: "satellite",
    hint: "HERE satelitní snímky",
    kind: "raster",
    proxy: { provider: "here", mapset: "satellite" },
    requiresCapability: "here",
    maxzoom: 20,
    imagery: true,
    attribution: [
      { label: "© HERE", url: "https://legal.here.com/terms", license: "HERE Service Terms" }
    ]
  },
  {
    id: "maptiler-streets",
    label: "MapTiler Streets",
    group: "street",
    hint: "Vypilovaný OSM styl s dobrou typografií",
    kind: "raster",
    proxy: { provider: "maptiler", mapset: "streets-v2" },
    requiresCapability: "maptiler",
    maxzoom: 20,
    attribution: [
      OSM,
      {
        label: "© MapTiler",
        url: "https://www.maptiler.com/copyright/",
        license: "MapTiler Cloud Terms"
      }
    ]
  },
  {
    id: "maptiler-satellite",
    label: "MapTiler Satelitní",
    group: "satellite",
    hint: "Satelitní mozaika s celosvětovým pokrytím",
    kind: "raster",
    proxy: { provider: "maptiler", mapset: "satellite-v2" },
    requiresCapability: "maptiler",
    maxzoom: 20,
    imagery: true,
    attribution: [
      {
        label: "© MapTiler",
        url: "https://www.maptiler.com/copyright/",
        license: "MapTiler Cloud Terms"
      }
    ]
  },
  {
    id: "maptiler-outdoor",
    label: "MapTiler Outdoor",
    group: "outdoor",
    hint: "Turistický styl s vrstevnicemi pro celý svět",
    kind: "raster",
    proxy: { provider: "maptiler", mapset: "outdoor-v2" },
    requiresCapability: "maptiler",
    maxzoom: 20,
    attribution: [
      OSM,
      {
        label: "© MapTiler",
        url: "https://www.maptiler.com/copyright/",
        license: "MapTiler Cloud Terms"
      }
    ]
  },
  {
    id: "thunderforest-landscape",
    label: "Thunderforest Landscape",
    group: "outdoor",
    hint: "Krajinný styl s vrstevnicemi, hezký na výlety",
    kind: "raster",
    proxy: { provider: "thunderforest", mapset: "landscape" },
    requiresCapability: "thunderforest",
    maxzoom: 22,
    attribution: [
      OSM,
      {
        label: "© Thunderforest",
        url: "https://www.thunderforest.com/",
        license: "Thunderforest Service Terms"
      }
    ]
  },
  {
    id: "thunderforest-outdoors",
    label: "Thunderforest Outdoors",
    group: "outdoor",
    hint: "Zvýrazněné stezky, chaty a turistické značení",
    kind: "raster",
    proxy: { provider: "thunderforest", mapset: "outdoors" },
    requiresCapability: "thunderforest",
    maxzoom: 22,
    attribution: [
      OSM,
      {
        label: "© Thunderforest",
        url: "https://www.thunderforest.com/",
        license: "Thunderforest Service Terms"
      }
    ]
  },
  {
    id: "stadia-alidade-satellite",
    label: "Stadia Alidade Satellite",
    group: "satellite",
    hint: "Satelitní podklad s jemným popisem",
    kind: "raster",
    proxy: { provider: "stadia", mapset: "alidade_satellite" },
    requiresCapability: "stadia",
    maxzoom: 20,
    attribution: [
      OSM,
      {
        label: "© Stadia Maps",
        url: "https://stadiamaps.com/attribution/",
        license: "Stadia Maps Service Terms"
      }
    ]
  },
  {
    id: "tomtom-basic",
    label: "TomTom Basic",
    group: "street",
    hint: "Navigační styl TomTom",
    kind: "raster",
    proxy: { provider: "tomtom", mapset: "basic" },
    requiresCapability: "tomtom",
    maxzoom: 22,
    attribution: [
      { label: "© TomTom", url: "https://www.tomtom.com/", license: "TomTom Maps API Terms" }
    ]
  },
  {
    id: "geoapify-osm-bright",
    label: "Geoapify OSM Bright",
    group: "street",
    hint: "Světlý OSM styl s velkorysým free tierem",
    kind: "raster",
    proxy: { provider: "geoapify", mapset: "osm-bright" },
    requiresCapability: "geoapify",
    maxzoom: 20,
    attribution: [
      OSM,
      {
        label: "© Geoapify",
        url: "https://www.geoapify.com/",
        license: "Geoapify Platform Terms"
      }
    ]
  }
];

export const LABEL_OVERLAYS: LabelOverlayDefinition[] = [
  {
    id: "carto-labels",
    label: "Popisky CARTO",
    tiles: ["https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png"],
    darkTiles: ["https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png"],
    attribution: [
      OSM,
      {
        label: "© CARTO",
        url: "https://carto.com/attributions",
        license: "CARTO Maps API Terms"
      }
    ]
  },
  {
    id: "mapy-names",
    label: "Popisky Mapy.com",
    proxy: { provider: "mapy", mapset: "names-overlay" },
    requiresCapability: "mapy",
    attribution: [
      { label: "© Seznam.cz a.s.", url: "https://mapy.com/", license: "Mapy.com API Terms" }
    ]
  }
];

export const DEFAULT_BASEMAP_ID = "carto-voyager";

export function basemapById(id: string): BasemapDefinition | undefined {
  return BASEMAPS.find((b) => b.id === id);
}

function permitted(
  entry: { requiresCapability?: string },
  capabilities: Record<string, boolean | string> | null
): boolean {
  if (!entry.requiresCapability) return true;
  return Boolean(capabilities?.[entry.requiresCapability]);
}

/** The backgrounds this deployment can actually draw. A basemap whose key is missing is hidden
 *  rather than offered and then failing tile by tile. */
export function availableBasemaps(
  capabilities: Record<string, boolean | string> | null
): BasemapDefinition[] {
  return BASEMAPS.filter((b) => permitted(b, capabilities));
}

/** Which label overlay to draw over imagery. Mapy's own labels match its aerial photos best, so
 *  they win when both are available; CARTO's are the keyless fallback. */
export function labelOverlayFor(
  basemap: BasemapDefinition,
  capabilities: Record<string, boolean | string> | null
): LabelOverlayDefinition | null {
  if (!basemap.imagery) return null;
  const preferred = basemap.id.startsWith("mapy-") ? "mapy-names" : "carto-labels";
  const ordered = [
    LABEL_OVERLAYS.find((o) => o.id === preferred),
    ...LABEL_OVERLAYS.filter((o) => o.id !== preferred)
  ].filter((o): o is LabelOverlayDefinition => Boolean(o));
  return ordered.find((o) => permitted(o, capabilities)) ?? null;
}

/** True when any part of the drawn map comes from Mapy.com, which obliges us to show their logo
 *  — including the case where only the label overlay is theirs. */
export function usesMapyTiles(basemapId: string, overlay: LabelOverlayDefinition | null): boolean {
  return basemapId.startsWith("mapy-") || overlay?.id === "mapy-names";
}
