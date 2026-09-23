import { createAirQualityLayer } from "../environment/airQualityLayer";
import { createDroughtLayer } from "../environment/droughtLayer";
import { layerV1ToV2 } from "@mapos/layer-sdk";
import { registerLayer, registerLayerV2 } from "../registry";
import { createTileLayer } from "../tileLayer";

function wms(endpoint: string, layers: string, extra = "") {
  return `${endpoint}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${layers}&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE${extra}`;
}

registerLayer({
  kind: "raster",
  areaFilter: "context",
  manifest: {
    id: "europe-drought",
    name: "Sucho · Evropa",
    icon: "☀️",
    color: "#e69f00",
    category: "environment",
    description:
      "Copernicus CDI v4.1 · poslední edice zveřejněná zdrojem, datum v atribuci mapy. Stav sucha, nikoliv předpověď. Průhlednost nerozlišuje chybějící data od absence indikace sucha."
  },
  defaultOpacity: 0.65,
  legend: {
    type: "categorical",
    title: "Sucho · CDI",
    items: [
      { label: "Watch · sledování", color: "#f0e442" },
      { label: "Warning · varování", color: "#e69f00" },
      { label: "Alert · výstraha", color: "#ff0000" }
    ]
  },
  create: (ctx) => createDroughtLayer(ctx.map, ctx.apiBaseUrl, ctx.layerId),
  attribution: [
    {
      label: "European Union · Copernicus CEMS",
      url: "https://drought.emergency.copernicus.eu/terms%26conditions/",
      license: "Copernicus CEMS terms and conditions"
    }
  ]
});

registerLayer({
  kind: "raster",
  areaFilter: "context",
  manifest: {
    id: "emodnet-bathymetry",
    name: "Hloubka moře · mapový přehled",
    icon: "🌊",
    color: "#087eae",
    category: "environment",
    description:
      "EMODnet · barevný model mořského dna. Číselné mediány buněk se připravují. Neobsahuje hloubky jezer ani aktuální hladinu; neslouží k navigaci. Přiblížení nezvyšuje přesnost modelu."
  },
  defaultOpacity: 0.7,
  create: (ctx) =>
    createTileLayer(ctx.map, ctx.layerId, {
      tiles: [wms("https://ows.emodnet-bathymetry.eu/wms", "emodnet:mean")],
      minzoom: 2,
      maxzoom: 14,
      attribution: "EMODnet Bathymetry consortium · model mořského dna"
    }),
  attribution: [
    {
      label: "EMODnet Bathymetry consortium",
      url: "https://emodnet.ec.europa.eu/en/bathymetry",
      license: "EMODnet Bathymetry DTM terms of use"
    }
  ]
});

registerLayer({
  kind: "raster",
  areaFilter: "context",
  manifest: {
    id: "gbif-density",
    name: "Záznamy přírody · přehled",
    icon: "🦋",
    color: "#2a9d58",
    category: "environment",
    description:
      "Hustota publikovaných pozorování GBIF. Nevyjadřuje počet zvířat ani skutečnou druhovou rozmanitost; závisí na aktivitě pozorovatelů a pokrytí zdrojů."
  },
  defaultOpacity: 0.65,
  create: (ctx) =>
    createTileLayer(ctx.map, ctx.layerId, {
      tiles: [
        "https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png?srs=EPSG:3857&bin=hex&hexPerTile=30&style=green.poly"
      ],
      maxzoom: 14,
      attribution: "GBIF · hustota publikovaných pozorování"
    }),
  attribution: [
    {
      label: "GBIF",
      url: "https://www.gbif.org",
      license: "GBIF terms of use; source datasets retain their licenses"
    }
  ]
});

registerLayerV2({
  areaFilter: "context",
  viewportCost: "cheap",
  manifest: {
    ...layerV1ToV2(
      {
        id: "cams-air-quality",
        name: "Ovzduší · model CAMS",
        icon: "☁",
        color: "#50b8ab",
        category: "environment",
        description:
          "PM2.5, PM10 a evropský AQI. Modelová hodnota ve středu stabilní buňky; nejde o měření stanic ani průměr celé plochy. Europe11km / Global45km, čas platnosti v atribuci."
      },
      { kind: "raster" }
    ),
    source: {
      type: "server-adapter",
      adapterId: "cams-air-quality-grid",
      endpoint: "/api/environment/air-quality/grid",
      method: "GET",
      requiresServerProxy: true
    },
    queryPolicy: {
      strategy: "viewport",
      maxResultsPerViewport: 48,
      cacheTtlSeconds: 0,
      searchHere: "never",
      debounceMs: 300,
      areaFilter: "context"
    },
    filters: [
      {
        id: "variable",
        label: "Veličina",
        kind: "single-select",
        options: [
          { id: "pm2_5", label: "PM2.5" },
          { id: "pm10", label: "PM10" },
          { id: "european_aqi", label: "Evropský AQI" }
        ]
      }
    ],
    capabilities: ["query", "filter"],
    legend: {
      type: "categorical",
      title: "Evropská škála · zvolená veličina",
      items: [
        { label: "Dobrá", color: "#50b8ab" },
        { label: "Uspokojivá", color: "#85b66f" },
        { label: "Střední", color: "#eed76c" },
        { label: "Špatná", color: "#e77e4d" },
        { label: "Velmi špatná", color: "#b84d70" },
        { label: "Extrémně špatná", color: "#773c70" }
      ]
    },
    attribution: [
      {
        label: "CAMS ENSEMBLE · Open-Meteo",
        url: "https://open-meteo.com/en/docs/air-quality-api",
        license: "CC BY4.0; Open-Meteo API usage terms"
      }
    ]
  },
  defaultFilters: { variable: "pm2_5" },
  defaultOpacity: 0.6,
  create: (ctx) => createAirQualityLayer(ctx.map, ctx.apiBaseUrl, ctx.layerId)
});
