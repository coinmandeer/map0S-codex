import type { IconName } from "../kit/icons";
import { OSM_POI_CATEGORIES, type FilterValues } from "@mapos/layer-sdk";
import { CZECH_LAYERS, CZECH_SUBGROUPS } from "../../layers/plugins/czechSources";
/** `icon` is only for rows whose source is not registered yet: it keeps the wireframe row from
 *  showing the generic fallback glyph while the integration is still being built. Rows backed by
 *  a plugin take their icon from the layer presentation table instead. */
export interface CatalogItem {
  id: string;
  cs: string;
  en: string;
  layer: string;
  facet?: string;
  values?: string[];
  related?: RelatedRef[];
  icon?: IconName;
  subgroup?: { id?: string; cs: string; en: string };
}
/** A second source shown under a row. A string names a whole layer; the object form names one
 *  facet of a shared layer, so several rows can draw from one tile source (`street-objects`) on
 *  the plan's "shared control, one datasource" rule (§2.4). */
export type RelatedRef =
  string | { layer: string; facet?: string; values?: string[]; cs?: string; en?: string };
export interface CatalogGroup {
  id: string;
  cs: string;
  en: string;
  parent?: string;
  items: CatalogItem[];
}
const item = (layer: string, cs: string, en: string, related?: RelatedRef[]): CatalogItem => ({
  id: layer,
  layer,
  cs,
  en,
  related
});
const part = (
  id: string,
  layer: string,
  facet: string,
  values: string[],
  cs: string,
  en: string
): CatalogItem => ({ id, layer, facet, values, cs, en });
const poi = (id: keyof typeof OSM_POI_CATEGORIES, en: string) =>
  part(`poi-${id}`, "osm-poi", "categories", [id], OSM_POI_CATEGORIES[id].label, en);
const LEGACY_GROUPS: CatalogGroup[] = [
  {
    id: "mine",
    cs: "Moje vrstvy",
    en: "My layers",
    items: [
      item("my-saved-places", "Uložená místa", "Saved places"),
      item("user-layers", "Moje vrstvy", "My layers")
    ]
  },
  {
    id: "weather",
    cs: "Počasí",
    en: "Weather",
    items: [
      item("weather-radar", "Srážkový radar", "Rain radar"),
      item("weather-precipitation", "Srážky", "Precipitation"),
      item("weather-temperature", "Teplota", "Temperature"),
      item("weather-wind", "Vítr", "Wind"),
      item("weather-gusts", "Nárazy větru", "Wind gusts"),
      item("weather-clouds", "Oblačnost", "Cloud cover"),
      item("weather-pressure", "Tlak", "Pressure"),
      item("weather-humidity", "Vlhkost", "Humidity")
    ]
  },
  {
    id: "transport",
    cs: "Doprava a provoz",
    en: "Transport & traffic",
    items: [
      item("live-aircraft", "Letadla (živě)", "Live aircraft"),
      item("live-vessels", "Lodě (živě)", "Live ships"),
      item("roads", "Silnice a dálnice", "Highways & roads"),
      item("shared-mobility", "Sdílená kola a koloběžky", "Shared bikes & scooters"),
      {
        ...part(
          "mapillary-signs",
          "street-objects",
          "categories",
          ["signs"],
          "Dopravní značky",
          "Traffic signs"
        ),
        icon: "signpost"
      },
      item("openrailwaymap", "Železnice", "Railways"),
      part(
        "aviation",
        "osm-poi",
        "categories",
        ["airport", "helipad"],
        "Letecká infrastruktura",
        "Aviation infrastructure"
      ),
      item("openseamap", "Námořní značky", "Nautical marks"),
      item("satellites", "Družice", "Space satellites"),
      {
        ...part(
          "mapillary-traffic",
          "street-objects",
          "categories",
          ["crossings"],
          "Přechody a řízení dopravy",
          "Crossings & traffic control"
        ),
        icon: "traffic"
      }
    ]
  },
  {
    id: "infrastructure",
    cs: "Infrastruktura",
    en: "Infrastructure",
    items: [
      {
        ...part("power", "openinframap", "network", ["power"], "Elektřina", "Power"),
        related: [
          {
            layer: "street-objects",
            facet: "categories",
            values: ["power"],
            cs: "Objekty sloupů (Mapillary)",
            en: "Pole objects (Mapillary)"
          }
        ]
      },
      {
        ...part("network", "openinframap", "network", ["telecoms"], "Sítě", "Networks"),
        related: [
          {
            layer: "street-objects",
            facet: "categories",
            values: ["network"],
            cs: "Síťové objekty (Mapillary)",
            en: "Network objects (Mapillary)"
          }
        ]
      },
      part("petroleum", "openinframap", "network", ["petroleum"], "Ropa a plyn", "Petroleum"),
      {
        ...part("water", "openinframap", "network", ["water"], "Voda", "Water"),
        related: [
          {
            layer: "street-objects",
            facet: "categories",
            values: ["water"],
            cs: "Vodní objekty (Mapillary)",
            en: "Water objects (Mapillary)"
          }
        ]
      },
      {
        ...part(
          "mapillary-furniture",
          "street-objects",
          "categories",
          ["furniture"],
          "Vybavení veřejného prostoru",
          "Public space furniture"
        ),
        icon: "chair_alt"
      }
    ]
  },
  {
    id: "food",
    parent: "places",
    cs: "Jídlo a pití",
    en: "Food & drinks",
    items: [
      poi("bar", "Bars"),
      poi("cafe", "Cafes"),
      poi("restaurant", "Restaurants"),
      poi("brewery", "Breweries"),
      poi("shop", "Shops"),
      poi("drinking_water", "Drinking water")
    ]
  },
  {
    id: "travel",
    parent: "places",
    cs: "Cestování a služby",
    en: "Travel & services",
    items: [
      poi("parking", "Parking"),
      poi("fuel", "Fuel"),
      { ...poi("charging", "Charging"), related: ["charging-stations"] },
      { ...poi("toilets", "Toilets"), related: ["refuge-restrooms"] },
      poi("shower", "Showers"),
      poi("dump_station", "Disposal points"),
      poi("camp_site", "Campsites"),
      poi("caravan_site", "Caravan sites"),
      poi("alpine_hut", "Mountain huts"),
      poi("shelter", "Shelters")
    ]
  },
  {
    id: "nature-history",
    parent: "places",
    cs: "Příroda a historie",
    en: "Nature & history",
    items: [
      poi("viewpoint", "Viewpoints"),
      poi("waterfall", "Waterfalls"),
      poi("lake", "Lakes"),
      poi("peak", "Peaks"),
      poi("observation_tower", "Observation towers"),
      poi("nature_park", "Nature parks"),
      poi("cave", "Caves"),
      poi("lighthouse", "Lighthouses"),
      poi("castle", "Castles"),
      poi("palace", "Palaces"),
      poi("ruins", "Ruins"),
      poi("museum", "Museums"),
      poi("monument", "Monuments")
    ]
  },
  {
    id: "sport",
    parent: "places",
    cs: "Sport",
    en: "Sport",
    items: [
      part(
        "walking",
        "waymarked-trails",
        "activity",
        ["hiking"],
        "Turistické trasy",
        "Walking trails"
      ),
      part(
        "cycling",
        "waymarked-trails",
        "activity",
        ["cycling"],
        "Cyklistické trasy",
        "Cycling routes"
      ),
      part("mtb", "waymarked-trails", "activity", ["mtb"], "MTB trasy", "MTB trails"),
      {
        ...item("cyclosm", "Cyklistická infrastruktura", "Bicycle infrastructure", [
          {
            layer: "street-objects",
            facet: "categories",
            values: ["cycle"],
            cs: "Cyklistické objekty (Mapillary)",
            en: "Cycling objects (Mapillary)"
          }
        ])
      },
      item("opensnowmap", "Lyžařské areály a trasy", "Ski areas & trails"),
      part("riding", "waymarked-trails", "activity", ["riding"], "Jezdecké trasy", "Riding trails"),
      poi("via_ferrata", "Ferratas"),
      poi("climbing", "Climbing"),
      part(
        "fitness",
        "osm-poi",
        "categories",
        ["fitness_trail", "fitness_centre"],
        "Fitness",
        "Fitness"
      ),
      part("poi-disc_golf", "osm-poi", "categories", ["disc_golf"], "Disc golf", "Disc golf"),
      part("poi-golf", "osm-poi", "categories", ["golf"], "Golf", "Golf"),
      poi("skatepark", "Skateparks"),
      poi("swimming", "Swimming"),
      poi("sports_centre", "Sports centres")
    ]
  },
  {
    id: "environment",
    parent: "earth",
    cs: "Prostředí",
    en: "Environment",
    items: [
      item("cams-air-quality", "Ovzduší a měřicí stanice", "Air quality & stations", [
        "air-quality",
        "openaq"
      ]),
      item("geology", "Geologie", "Geology"),
      item("natura2000", "Chráněná území", "Protected areas"),
      item("land-cover", "Pokryv krajiny", "Land cover"),
      item("snow-cover", "Sněhová pokrývka", "Snow cover"),
      item("dark-sky", "Noční světla (2016)", "Night lights (2016)"),
      item("emodnet-bathymetry", "Hloubka vody", "Water depth")
    ]
  },
  {
    id: "wildlife",
    parent: "earth",
    cs: "Flóra a fauna",
    en: "Flora & fauna",
    items: [
      ...[
        ["Mammalia", "Savci", "Mammals"],
        ["Aves", "Ptáci", "Birds"],
        ["Insecta", "Hmyz", "Insects"],
        ["Plantae", "Rostliny", "Plants"],
        ["Fungi", "Houby", "Fungi"],
        ["Amphibia", "Obojživelníci", "Amphibians"]
      ].map(([v, cs, en]) => ({
        ...part(`nature-${v}`, "inaturalist", "taxon", [v!], cs!, en!),
        related: v === "Aves" ? ["ebird", "gbif", "gbif-density"] : ["gbif", "gbif-density"]
      }))
    ]
  },
  {
    id: "earth-events",
    parent: "earth",
    cs: "Přírodní události",
    en: "Natural events",
    items: [
      item("active-fires", "Aktivní požáry", "Active fires"),
      item("earthquakes", "Zemětřesení", "Earthquakes"),
      ...[
        ["severeStorms", "Bouře", "Storms"],
        ["volcanoes", "Sopky", "Volcanoes"],
        ["floods", "Povodně", "Floods"]
      ].map(([v, cs, en]) => part(`eonet-${v}`, "eonet", "category", [v!], cs!, en!)),
      item("europe-drought", "Sucho", "Drought"),
      ...[
        ["dustHaze", "Prach", "Dust"],
        ["tempExtremes", "Teplotní extrémy", "Temperature extremes"],
        ["landslides", "Sesuvy", "Landslides"],
        ["manmade", "Události způsobené člověkem", "Human-caused events"]
      ].map(([v, cs, en]) => part(`eonet-${v}`, "eonet", "category", [v!], cs!, en!))
    ]
  },
  {
    id: "community",
    cs: "Komunita a hra",
    en: "Community & play",
    items: [
      part("map-notes", "game-quests", "sources", ["osm-notes"], "Poznámky v mapě", "Map notes"),
      item("temporary-messages", "Dočasné zprávy", "Temporary messages"),
      part(
        "geocaches",
        "game-quests",
        "sources",
        ["opencaching"],
        "Geocachingové keše",
        "Geocaching caches"
      ),
      part(
        "quests",
        "game-quests",
        "sources",
        ["wlm-photo", "turf-zones"],
        "Herní questy",
        "Game quests"
      ),
      item("meshcore", "MeshCore síť", "MeshCore network"),
      item("game", "3D svět", "3D world")
    ]
  },
  {
    id: "finance",
    cs: "Finance",
    en: "Finance",
    items: [
      poi("atm", "Cash machines"),
      poi("bank", "Banks"),
      { ...poi("bitcoin_atm", "Bitcoin ATMs"), icon: "account_balance_wallet" },
      { ...poi("bitcoin", "Bitcoin payments"), icon: "payments" }
    ]
  },
  { id: "events", cs: "Události", en: "Events", items: [item("events", "Události", "Events")] },
  {
    id: "media",
    cs: "Fotografie a média",
    en: "Photos & media",
    items: [
      item("webcams", "Webkamery", "Webcams"),
      item("commons-photos", "Fotografie", "Photos"),
      item("mapillary", "Snímky ulic", "Street imagery"),
      item("panoramax", "Fotky ulic (Panoramax)", "Street photos (Panoramax)")
    ]
  },
  {
    id: "integrations",
    cs: "Externí integrace",
    en: "External integrations",
    items: [
      item("park4night", "Místa pro obytná auta", "Motorhome stops"),
      item("overture-places", "Místa a služby z importu", "Imported places & services"),
      item("overture-buildings", "Budovy z importu", "Imported buildings")
    ]
  }
];
// Stable thematic order; source identity never determines the top-level category.
const rows = (id: string) => LEGACY_GROUPS.find((group) => group.id === id)!.items;
const historic = new Set(["poi-castle", "poi-palace", "poi-ruins", "poi-museum", "poi-monument"]);
export const CATALOG_GROUPS: CatalogGroup[] = [
  {
    id: "czech-land",
    cs: "Pozemky a území ČR",
    en: "Czech land & territories",
    items: CZECH_LAYERS.map((def) => ({
      id: def.id,
      layer: def.id,
      cs: def.cs,
      en: def.en,
      icon: "map",
      subgroup: CZECH_SUBGROUPS.find((group) => group.id === def.group)!
    }))
  },
  {
    id: "places",
    cs: "Místa a služby",
    en: "Places & services",
    items: [
      ...rows("food"),
      ...rows("travel"),
      ...rows("nature-history").filter((i) => historic.has(i.id)),
      ...rows("finance"),
      rows("integrations")[0]!,
      rows("integrations")[1]!
    ]
  },
  {
    id: "weather",
    cs: "Počasí a ovzduší",
    en: "Weather & air quality",
    items: [...rows("weather"), rows("environment")[0]!]
  },
  {
    id: "transport",
    cs: "Doprava a infrastruktura",
    en: "Transport & infrastructure",
    items: [
      ...rows("transport").filter((i) => i.layer !== "satellites"),
      ...rows("infrastructure"),
      rows("integrations")[2]!
    ]
  },
  {
    id: "nature",
    cs: "Příroda, výlety a sport",
    en: "Nature, outdoors & sport",
    items: [
      ...rows("nature-history").filter((i) => !historic.has(i.id)),
      ...rows("sport"),
      ...rows("environment").slice(1),
      ...rows("wildlife")
    ]
  },
  {
    id: "events",
    cs: "Události a rizika",
    en: "Events & risks",
    items: [
      ...rows("events"),
      ...rows("earth-events").map((item) => ({
        ...item,
        subgroup: { cs: "Přírodní a další rizika", en: "Natural & other hazards" }
      }))
    ]
  },
  { id: "media", cs: "Fotografie a pozorování", en: "Photos & observations", items: rows("media") },
  { id: "society", cs: "Společnost a území", en: "Society & territories", items: [] },
  {
    id: "space",
    cs: "Vesmír",
    en: "Space",
    items: rows("transport").filter((i) => i.layer === "satellites")
  },
  { id: "community", cs: "Komunita a hra", en: "Community & play", items: rows("community") },
  { id: "mine", cs: "Moje vrstvy", en: "My layers", items: rows("mine") }
];

export type CatalogLayers = Record<
  string,
  { visible: boolean; selected?: boolean; opacity: number; filters: FilterValues }
>;
export function catalogGroupState(
  items: CatalogItem[],
  layers: CatalogLayers,
  reasonFor: (item: CatalogItem) => string | undefined
) {
  const eligible = items.filter(
    (item) => !reasonFor(item) || catalogItemState(item, layers).enabled
  );
  const enabled = items.filter((item) => catalogItemState(item, layers).enabled).length;
  return {
    enabled,
    available: eligible.length,
    state: (enabled === 0
      ? false
      : eligible.length > 0 && enabled === eligible.length
        ? true
        : "mixed") as boolean | "mixed"
  };
}
const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : typeof v === "string"
      ? [v]
      : [];
export function catalogItemState(item: CatalogItem, layers: CatalogLayers) {
  const layer = layers[item.layer];
  if (!item.facet)
    return { selected: !!layer && layer.selected !== false, enabled: !!layer?.visible };
  const values = list(layer?.filters[item.facet]);
  const selected = list(layer?.filters[`_selected_${item.facet}`] ?? values);
  return {
    selected: layer?.selected !== false && item.values!.some((v) => selected.includes(v)),
    enabled: !!layer?.visible && item.values!.some((v) => values.includes(v))
  };
}
export function catalogItemPatch(
  item: CatalogItem,
  layers: CatalogLayers,
  enabled: boolean,
  remove = false
): FilterValues | null {
  if (!item.facet) return null;
  const filters = layers[item.layer]?.filters ?? {};
  const current = list(filters[item.facet]);
  const selected = list(filters[`_selected_${item.facet}`] ?? current);
  const values = new Set(item.values);
  return {
    ...filters,
    [item.facet]: enabled
      ? [...new Set([...current, ...item.values!])]
      : current.filter((v) => !values.has(v)),
    [`_selected_${item.facet}`]: remove
      ? selected.filter((v) => !values.has(v))
      : [...new Set([...selected, ...item.values!])]
  };
}
