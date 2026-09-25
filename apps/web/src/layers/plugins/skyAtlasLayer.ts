import type { GeoJSONSource } from "maplibre-gl";
import { registerLayer } from "../registry";
import { fetchLayerFeatures } from "../../engine/LayerEngine";
import { registerInteractivePins, unregisterInteractivePins } from "../../map/interactivePins";
registerLayer({
  kind: "pins",
  areaFilter: "context",
  manifest: {
    id: "sky-brightness",
    name: "Model jasu oblohy (2015)",
    icon: "🌌",
    color: "#22c55e",
    category: "environment",
    requiresCapability: "skyAtlas",
    description:
      "Historický model umělé složky zenitového jasu, bez přirozeného pozadí, počasí a Měsíce. Pokrytí podle nahraného atlasu, nejvýše přibližně 60° j. š. až 85° s. š. Při oddálení řídký vzorek pixelů, nikoli průměr buňky; lineární barvy jsou nad 10 mcd/m² syté, přesná hodnota je po kliknutí. Nevykreslená oblast znamená bez dat."
  },
  defaultOpacity: 0.65,
  legend: {
    type: "continuous",
    unit: "mcd/m²",
    min: 0,
    max: 10,
    stops: [
      { value: 0, label: "0", color: "#e0f2fe" },
      { value: 5, label: "5", color: "#22c55e" },
      { value: 10, label: "10+", color: "#dc2626" }
    ],
    title: "Umělý zenitový jas · model 2015 (mcd/m²)",
    items: [
      { label: "0", color: "#e0f2fe" },
      { label: "5", color: "#22c55e" },
      { label: "10+", color: "#dc2626" },
      { label: "Bez dat: nevykreslená buňka", color: "transparent" }
    ]
  },
  attribution: [
    {
      label: "Falchi et al. (2016), doi:10.1126/sciadv.1600377",
      url: "https://doi.org/10.5880/GFZ.1.4.2016.001",
      license: "CC BY-NC 4.0"
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
          ["get", "brightness"],
          0,
          "#e0f2fe",
          5,
          "#22c55e",
          10,
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
