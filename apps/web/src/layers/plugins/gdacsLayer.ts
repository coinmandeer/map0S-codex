import type { GeoJSONSource } from "maplibre-gl";
import { registerLayer } from "../registry";
import { createDataLayer } from "../dataLayer";
import { registerInteractivePins, unregisterInteractivePins } from "../../map/interactivePins";

registerLayer({
  kind: "pins",
  areaFilter: "context",
  manifest: {
    id: "disaster-impacts",
    name: "Katastrofy — modelované dopady",
    icon: "⚠️",
    color: "#ea580c",
    category: "environment",
    description:
      "GDACS, události posledních sedmi dní a modelované oblasti při přiblížení. Barva je úroveň upozornění GDACS, nikoli naměřená intenzita. Automatické odhady nenahrazují místní varování. Pokrytí je omezené výběrem událostí podle středu."
  },
  attribution: [
    {
      label: "GDACS · European Commission / UN",
      url: "https://www.gdacs.org/About/termofuse.aspx",
      license: "GDACS Terms of Use / European Commission copyright policy"
    }
  ],
  legend: {
    type: "categorical",
    title: "Úroveň GDACS · modelovaný dopad",
    items: [
      { label: "Green", color: "#16a34a" },
      { label: "Orange", color: "#ea580c" },
      { label: "Red", color: "#dc2626" },
      { label: "Úroveň neuvedena", color: "#64748b" }
    ]
  },
  defaultOpacity: 0.65,
  create(ctx) {
    const map = ctx.map,
      source = `source-${ctx.layerId}-areas`,
      layer = `pins-${ctx.layerId}-areas`;
    const colors = { Green: "#16a34a", Orange: "#ea580c", Red: "#dc2626" };
    const pins = createDataLayer(map, ctx.apiBaseUrl, ctx.layerId, {
      color: "#ea580c",
      colorBy: { property: "alert", values: colors, fallback: "#64748b" },
      cluster: false
    });
    map.addSource(source, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: layer,
      type: "fill",
      source,
      paint: {
        "fill-color": [
          "match",
          ["get", "alert"],
          "Green",
          colors.Green,
          "Orange",
          colors.Orange,
          "Red",
          colors.Red,
          "#64748b"
        ],
        "fill-opacity": 0.25
      }
    });
    registerInteractivePins(map, ctx.layerId, [layer]);
    return {
      update: pins.update,
      setData(data) {
        pins.setData?.(data);
        const features: GeoJSON.Feature[] = [];
        for (const event of data.features) {
          const footprints = event.properties.footprints;
          if (!Array.isArray(footprints)) continue;
          for (const [index, footprint] of footprints.entries()) {
            if (!footprint || !["Polygon", "MultiPolygon"].includes(footprint.geometry?.type))
              continue;
            features.push({
              type: "Feature",
              geometry: footprint.geometry,
              properties: {
                ...event.properties,
                id: `${event.properties.id}:footprint:${index}`,
                name: `${event.properties.name} · ${footprint.label}`,
                footprintTime: footprint.time,
                footprintType: footprint.category
              }
            });
          }
        }
        (map.getSource(source) as GeoJSONSource | undefined)?.setData({
          type: "FeatureCollection",
          features
        });
      },
      setVisible(visible) {
        pins.setVisible?.(visible);
        if (map.getLayer(layer))
          map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
      },
      setOpacity(opacity) {
        pins.setOpacity?.(opacity);
        if (map.getLayer(layer)) map.setPaintProperty(layer, "fill-opacity", opacity * 0.4);
      },
      detach() {
        unregisterInteractivePins(map, [layer]);
        if (map.getLayer(layer)) map.removeLayer(layer);
        if (map.getSource(source)) map.removeSource(source);
        pins.detach?.();
      }
    };
  }
});
