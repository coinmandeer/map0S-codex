import { registerLayer } from "../registry";
import { createTileLayer } from "../tileLayer";

for (const [id, property, name, unit, conversion] of [
  [
    "soil-ph",
    "phh2o",
    "Kyselost půdy · pH",
    "pH × 10",
    "Čísla oficiální legendy dělit deseti pro hodnotu pH."
  ],
  ["soil-carbon", "soc", "Organický uhlík v půdě", "dg/kg", "10 dg/kg odpovídá 1 g/kg."],
  ["soil-clay", "clay", "Jílovitost půdy", "g/kg", "10 g/kg odpovídá 1 % hmotnosti."]
] as const) {
  const layer = `${property}_0-5cm_mean`;
  const endpoint = `https://maps.isric.org/mapserv?map=/map/${property}.map`;
  registerLayer({
    kind: "raster",
    areaFilter: "context",
    defaultOpacity: 0.7,
    manifest: {
      id,
      name,
      icon: "🌱",
      color: "#9a6b37",
      category: "environment",
      description: `SoilGrids 2.0 (2020), model 250 m, průměrná predikce v hloubce 0–5 cm. ${conversion} Statický model s nejistotou, nikoli aktuální rozbor půdy. Bez numerického vzorkování barev. Pokrytí přibližně 56° j. š. až 83° s. š.`
    },
    legend: {
      type: "image",
      title: `${name} · 0–5 cm`,
      unit,
      items: [
        {
          label: `Oficiální stupnice (${unit}); ${conversion}`,
          imageUrl: `${endpoint}&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetLegendGraphic&SLD_VERSION=1.1.0&LAYER=${layer}&FORMAT=image/png&STYLE=default`
        },
        { label: "Průhledné oblasti: bez dat" }
      ]
    },
    attribution: [
      {
        label: "ISRIC · SoilGrids 2.0 · Poggio et al. (2021)",
        url: "https://doi.org/10.5194/soil-7-217-2021",
        license: "CC BY 4.0"
      }
    ],
    create: (ctx) =>
      createTileLayer(ctx.map, ctx.layerId, {
        tiles: [
          `${endpoint}&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=default&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256`
        ],
        maxzoom: 12,
        attribution: "ISRIC · SoilGrids 2.0 · Poggio et al. (2021) · CC BY 4.0"
      })
  });
}
