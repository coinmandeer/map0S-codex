import { registerLayer } from "../registry";
import { createDataLayer } from "../dataLayer";
const layers = [
  {
    id: "marine-conditions",
    name: "Mořské podmínky",
    icon: "🌊",
    color: "#0284c7",
    description:
      "Jeden modelový vzorek u středu výřezu: výška a perioda vln, teplota hladiny a čas. Bod je na souřadnicích vrácené mořské buňky, která se může lišit od středu mapy. Prázdná oblast znamená bez dat, ne bezvětří. Nenahrazuje pobřežní navigaci.",
    attribution: [
      {
        label: "Open-Meteo · marine models",
        url: "https://open-meteo.com/en/docs/marine-weather-api",
        license: "CC BY 4.0; hosted API non-commercial use"
      }
    ]
  },
  {
    id: "solar-climate",
    name: "Sluneční energie a klima",
    icon: "☀️",
    color: "#d97706",
    description:
      "NASA POWER: roční klimatologický průměr denní sluneční energie (kWh/m²/den), teploty (°C) a srážek (mm/den) pro střed výřezu. Období dodává zdroj a je uvedeno v detailu. Hrubý regionální model, nikoli aktuální počasí nebo posouzení konkrétní střechy.",
    attribution: [
      {
        label: "NASA POWER · MERRA-2 / CERES",
        url: "https://power.larc.nasa.gov/docs/services/api/temporal/climatology/",
        license: "NASA open data; source acknowledgment"
      }
    ]
  }
];
for (const layer of layers)
  registerLayer({
    kind: "pins",
    areaFilter: "context",
    manifest: {
      id: layer.id,
      name: layer.name,
      icon: layer.icon,
      color: layer.color,
      category: "environment",
      description: layer.description
    },
    attribution: layer.attribution,
    detail: {
      fieldOrder:
        layer.id === "marine-conditions"
          ? ["waveHeight", "wavePeriod", "waterTemperature", "validAt", "source", "website"]
          : ["solarEnergy", "temperature", "precipitation", "period", "source", "website"]
    },
    legend: {
      type: "categorical",
      title: "Modelový vzorek · přesné hodnoty a čas v detailu",
      items: [
        { label: "Bod dotazu / modelová buňka", color: layer.color },
        { label: "Prázdná oblast: bez zobrazeného vzorku", color: "transparent" }
      ]
    },
    create: (ctx) =>
      createDataLayer(ctx.map, ctx.apiBaseUrl, ctx.layerId, {
        color: layer.color,
        cluster: false,
        labelFromZoom: 5
      })
  });
