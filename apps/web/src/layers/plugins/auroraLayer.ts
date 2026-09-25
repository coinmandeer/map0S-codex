import type { GeoJSONSource } from "maplibre-gl";
import { registerLayer } from "../registry";
import { fetchLayerFeatures } from "../../engine/LayerEngine";
import { registerInteractivePins, unregisterInteractivePins } from "../../map/interactivePins";
registerLayer({
  kind: "pins",
  areaFilter: "context",
  manifest: {
    id: "aurora",
    name: "Polární záře — předpověď",
    icon: "🌌",
    color: "#22c55e",
    category: "environment",
    description:
      "NOAA OVATION, krátkodobý modelový odhad záře v %. Při oddálení maximum v agregované buňce; čas předpovědi najdete po kliknutí. Nezohledňuje oblačnost, světelný smog ani denní světlo. Data starší než 3 hodiny se nezobrazují."
  },
  defaultOpacity: 0.65,
  legend: {
    type: "continuous",
    unit: "%",
    min: 0,
    max: 100,
    stops: [
      { value: 0, label: "0 %", color: "#e0f2fe" },
      { value: 50, label: "50 %", color: "#22c55e" },
      { value: 100, label: "100 %", color: "#dc2626" }
    ],
    title: "OVATION · modelový odhad (%)",
    items: [
      { label: "0 %", color: "#e0f2fe" },
      { label: "50 %", color: "#22c55e" },
      { label: "100 %", color: "#dc2626" },
      { label: "Bez dat: nevykreslená buňka", color: "transparent" }
    ]
  },
  attribution: [
    {
      label: "NOAA SWPC · OVATION",
      url: "https://www.spaceweather.gov/products/aurora-30-minute-forecast",
      license: "United States public domain"
    }
  ],
  create: (ctx) => {
    const map = ctx.map,
      source = `source-${ctx.layerId}`,
      layer = `pins-${ctx.layerId}-grid`;
    map.addSource(source, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: layer,
      type: "fill",
      source,
      paint: {
        "fill-color": [
          "interpolate",
          ["linear"],
          ["get", "probability"],
          0,
          "#e0f2fe",
          50,
          "#22c55e",
          100,
          "#dc2626"
        ],
        "fill-opacity": 0.65
      }
    });
    registerInteractivePins(map, ctx.layerId, [layer]);
    return {
      update: (bbox, filters, signal) =>
        fetchLayerFeatures(ctx.apiBaseUrl, ctx.layerId, bbox, filters, signal),
      setData: (data) => {
        const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
        for (const point of data.features) {
          const b = point.properties.cellBounds;
          if (
            !Array.isArray(b) ||
            b.length !== 4 ||
            !b.every((v) => typeof v === "number" && Number.isFinite(v))
          )
            continue;
          const [w, s, e, n] = b as number[];
          features.push({
            type: "Feature",
            properties: point.properties,
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [w!, s!],
                  [e!, s!],
                  [e!, n!],
                  [w!, n!],
                  [w!, s!]
                ]
              ]
            }
          });
        }
        (map.getSource(source) as GeoJSONSource | undefined)?.setData({
          type: "FeatureCollection",
          features
        });
      },
      setVisible: (visible) => {
        if (map.getLayer(layer))
          map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
      },
      setOpacity: (opacity) => {
        if (map.getLayer(layer)) map.setPaintProperty(layer, "fill-opacity", opacity);
      },
      detach: () => {
        unregisterInteractivePins(map, [layer]);
        if (map.getLayer(layer)) map.removeLayer(layer);
        if (map.getSource(source)) map.removeSource(source);
      }
    };
  }
});
