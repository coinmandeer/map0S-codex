import { registerLayer } from "../registry";
import { createTileLayer } from "../tileLayer";

// Source WMTS and a sample PNG verified on 2026-09-24. Historical RGB imagery is never sampled as numeric data.
registerLayer({
  kind: "raster",
  areaFilter: "context",
  defaultOpacity: 0.7,
  manifest: {
    id: "jrc-surface-water",
    name: "Výskyt povrchové vody · 1984–2024",
    icon: "🌊",
    color: "#0000ff",
    category: "environment",
    description:
      "JRC Global Surface Water v1.5, Landsat 30 m. Podíl platných pozorování s detekovanou vodou, 1984–2024. Historický výskyt, nikoli aktuální povodeň. Přechod mezi Landsat kolekcemi může posunout polohu až o pixel. Numerické analýzy vyžadují původní data."
  },
  legend: {
    type: "continuous",
    title: "Výskyt vody · 1984–2024",
    unit: "%",
    min: 0,
    max: 100,
    stops: [
      { value: 0, label: "0 %", color: "#ffffff" },
      { value: 25, label: "25 %", color: "#efbfcf" },
      { value: 50, label: "50 %", color: "#bf7fbf" },
      { value: 75, label: "75 %", color: "#6f3fcf" },
      { value: 100, label: "100 %", color: "#0000ff" }
    ],
    items: [{ label: "Průhledné: bez zobrazených dat; neznamená sucho." }]
  },
  create: (ctx) =>
    createTileLayer(ctx.map, ctx.layerId, {
      tiles: ["https://storage.googleapis.com/water-world/tiles2024/occurrence/{z}/{x}/{y}.png"],
      maxzoom: 13,
      attribution: "Source: EC JRC/Google · Pekel et al. (2016), doi:10.1038/nature20584"
    }),
  attribution: [
    {
      label: "Source: EC JRC/Google · Pekel et al. (2016)",
      url: "https://global-surface-water.appspot.com/download",
      license: "Copernicus open data"
    }
  ]
});

const gebcoCredit =
  "GEBCO Bathymetric Compilation Group 2026 · GEBCO_2026 Grid · NERC EDS BODC NOC · doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa";
registerLayer({
  kind: "raster",
  areaFilter: "context",
  defaultOpacity: 0.7,
  manifest: {
    id: "gebco-bathymetry",
    name: "Hloubka moří a reliéf · GEBCO 2026",
    icon: "🌊",
    color: "#2166ac",
    category: "environment",
    description:
      "Globální výškový model GEBCO 2026, mřížka 15 úhlových vteřin. Výška v metrech vzhledem ke střední hladině moře, hloubky jsou záporné. Kombinuje měření s interpolací; rozlišení mřížky není přesnost měření. Nevhodné pro navigaci a bezpečnost na moři."
  },
  legend: {
    type: "image",
    title: "GEBCO 2026 · výška / hloubka",
    unit: "m",
    items: [
      {
        label: "Oficiální stupnice GEBCO",
        imageUrl:
          "https://wms.gebco.net/2026/mapserv?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic&LAYER=GEBCO_2026_2&FORMAT=image/png&STYLE=default&SLD_VERSION=1.1.0"
      }
    ]
  },
  create: (ctx) =>
    createTileLayer(ctx.map, ctx.layerId, {
      tiles: [
        "https://wms.gebco.net/2026/mapserv?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=GEBCO_2026_2&STYLES=&FORMAT=image/png&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256"
      ],
      maxzoom: 12,
      attribution: gebcoCredit
    }),
  attribution: [
    {
      label: gebcoCredit,
      url: "https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid",
      license: "Public domain, attribution required"
    }
  ]
});

// Periods and palettes verified against JRC V2024 WMTS, metadata and QGIS symbology.
for (const layer of [
  {
    id: "jrc-water-seasonality",
    source: "seasonality",
    name: "Sezónnost povrchové vody · 2024",
    description:
      "Počet měsíců s detekovanou vodou v roce 2024. Landsat 30 m, GSW v1.5. Historický stav; nejde o aktuální povodně ani předpověď. RGB dlaždice neumožňují numerické dotazy.",
    unit: "měsíce",
    min: 0,
    max: 12,
    stops: [
      { value: 0, label: "0 — bez vody", color: "#ffffff" },
      { value: 1, label: "1 měsíc", color: "#8cc6e4" },
      { value: 6, label: "6 měsíců", color: "#4c6cca" },
      { value: 12, label: "12 měsíců", color: "#0000aa" }
    ],
    items: [{ label: "Bez dat / průhledné — neznamená sucho", color: "#cccccc" }]
  },
  {
    id: "jrc-water-change",
    source: "change",
    name: "Změny výskytu vody · 1984–2024",
    description:
      "Změna výskytu vody mezi obdobími 1984–1999 a 2000–2024. Landsat 30 m, GSW v1.5. Pokles je červený, nárůst zelený, beze změny černá. Kolekce mohou mít posun až o pixel. Historické porovnání, nikoli aktuální záplavy. RGB dlaždice neslouží k numerické analýze.",
    unit: "%",
    min: -100,
    max: 100,
    stops: [
      { value: -100, label: "−100 %", color: "#ff0000" },
      { value: -50, label: "−50 %", color: "#7f0000" },
      { value: 0, label: "Beze změny", color: "#000000" },
      { value: 50, label: "+50 %", color: "#007f00" },
      { value: 100, label: "+100 %", color: "#00ff00" }
    ],
    items: [
      { label: "Bez vody", color: "#ffffff" },
      { label: "Změnu nelze vypočítat", color: "#888888" },
      { label: "Bez dat / průhledné", color: "#c0c0c0" }
    ]
  }
])
  registerLayer({
    kind: "raster",
    areaFilter: "context",
    defaultOpacity: 0.7,
    manifest: {
      id: layer.id,
      name: layer.name,
      description: layer.description,
      icon: "🌊",
      color: "#2166ac",
      category: "environment"
    },
    legend: {
      type: "continuous",
      title: layer.name,
      unit: layer.unit,
      min: layer.min,
      max: layer.max,
      stops: layer.stops,
      items: layer.items
    },
    create: (ctx) =>
      createTileLayer(ctx.map, ctx.layerId, {
        tiles: [
          `https://storage.googleapis.com/water-world/tiles2024/${layer.source}/{z}/{x}/{y}.png`
        ],
        maxzoom: 13,
        attribution: "Source: EC JRC/Google · Pekel et al. (2016), doi:10.1038/nature20584"
      }),
    attribution: [
      {
        label: "Source: EC JRC/Google · Pekel et al. (2016)",
        url: "https://global-surface-water.appspot.com/download",
        license: "Copernicus open data"
      }
    ]
  });
