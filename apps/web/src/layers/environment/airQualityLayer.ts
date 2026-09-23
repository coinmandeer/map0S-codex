import type maplibregl from "maplibre-gl";
import type { Bbox, LayerHandle } from "@mapos/layer-sdk";
type Field = "pm2_5" | "pm10" | "european_aqi";
interface Grid {
  model: string;
  validAt: string;
  sourceResolutionKm: number;
  status: string;
  cells: Array<{ id: string; bbox: Bbox; values: Record<Field, number | null> }>;
}
const fields: Record<Field, { label: string; unit: string; stops: number[] }> = {
  pm2_5: { label: "PM2.5", unit: "μg/m³", stops: [5, 15, 50, 90, 140] },
  pm10: { label: "PM10", unit: "μg/m³", stops: [15, 45, 120, 195, 270] },
  european_aqi: { label: "Evropský AQI", unit: "EAQI", stops: [20, 40, 60, 80, 100] }
};
const colors = ["#50b8ab", "#85b66f", "#eed76c", "#e77e4d", "#b84d70", "#773c70"];
export function createAirQualityLayer(
  map: maplibregl.Map,
  apiBase: string,
  id: string
): LayerHandle {
  const source = `source-${id}-model`,
    fill = `fill-${id}-model`,
    labels = `labels-${id}-model`;
  let disposed = false,
    visible = true,
    opacity = 0.6,
    generation = 0;
  let cached: Grid | undefined,
    cacheBbox = "",
    expiresAt = 0;
  const clear = () => {
    const src = map.getSource(source) as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: [] });
  };
  const paint = (grid: Grid, field: Field) => {
    const definition = fields[field];
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: grid.cells.flatMap((cell) => {
        const value = cell.values[field];
        if (value === null || !Number.isFinite(value)) return [];
        const [w, s, e, n] = cell.bbox;
        const index = definition.stops.findIndex((stop) => value <= stop);
        const properties = {
          id: cell.id,
          name: definition.label,
          layerId: id,
          value,
          color: colors[index < 0 ? 5 : index],
          label: `${Math.round(value)} ${definition.unit}`
        };
        const shapes: GeoJSON.Feature[] = [
          {
            type: "Feature",
            id: cell.id,
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [w, s],
                  [e, s],
                  [e, n],
                  [w, n],
                  [w, s]
                ]
              ]
            },
            properties
          },
          {
            type: "Feature",
            id: `${cell.id}:label`,
            geometry: { type: "Point", coordinates: [(w + e) / 2, (s + n) / 2] },
            properties
          }
        ];
        return shapes;
      })
    };
    if (!map.getSource(source)) {
      map.addSource(source, {
        type: "geojson",
        data,
        attribution: `CAMS ${grid.model === "cams_europe" ? "Europe" : "Global"} · ${grid.sourceResolutionKm} km · ${grid.validAt} · Open-Meteo`
      });
      map.addLayer({
        id: fill,
        source,
        type: "fill",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": ["get", "color"], "fill-opacity": opacity }
      });
      map.addLayer({
        id: labels,
        source,
        type: "symbol",
        filter: ["==", ["geometry-type"], "Point"],
        layout: {
          "text-field": ["get", "label"],
          "text-size": 12,
          "text-font": ["Open Sans Regular"],
          "text-allow-overlap": false
        },
        paint: { "text-color": "#18232f", "text-halo-color": "#ffffff", "text-halo-width": 1 }
      });
    } else {
      (map.getSource(source) as maplibregl.GeoJSONSource).setData(data);
      // Source attribution is immutable for this hour; a new hour replaces the source below.
    }
    for (const layer of [fill, labels])
      map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
    return data;
  };
  const detachSources = () => {
    for (const layer of [labels, fill]) if (map.getLayer(layer)) map.removeLayer(layer);
    if (map.getSource(source)) map.removeSource(source);
  };
  return {
    async update(bbox, filters, signal) {
      if (disposed || !visible) return null;
      const own = ++generation,
        key = bbox.join(",");
      let grid = cached;
      if (!grid || cacheBbox !== key || Date.now() >= expiresAt) {
        const response = await fetch(
          `${apiBase}/environment/air-quality/grid?${new URLSearchParams({ bbox: key })}`,
          { signal }
        );
        if (!response.ok) throw new Error("Model ovzduší se nepodařilo načíst.");
        grid = (await response.json()) as Grid;
        signal?.throwIfAborted();
        if (disposed || !visible || own !== generation) return null;
        if (
          !grid.cells?.length ||
          !grid.cells.some((cell) => Object.values(cell.values).some((value) => value !== null))
        ) {
          clear();
          return {
            type: "FeatureCollection",
            features: [],
            query: { status: "unavailable", reason: "outside-coverage" },
            notice: "Pro tento výřez a hodinu nejsou modelová data."
          };
        }
        if (cached && (cached.validAt !== grid.validAt || cached.model !== grid.model))
          detachSources();
        cached = grid;
        cacheBbox = key;
        expiresAt = (Math.floor(Date.now() / 3600000) + 1) * 3600000;
      }
      const field =
        typeof filters.variable === "string" && filters.variable in fields
          ? (filters.variable as Field)
          : "pm2_5";
      const data = paint(grid, field);
      return {
        type: "FeatureCollection",
        features: [],
        query: {
          status: grid.status === "partial" ? "partial" : "complete",
          cacheTtlMs: 0,
          rendered: { count: data.features.length / 2, unit: "samples" }
        },
        ...(grid.status === "partial"
          ? { notice: "Část modelových hodnot chybí; zobrazeny jsou dostupné buňky." }
          : {})
      };
    },
    setVisible(value) {
      visible = value;
      if (!value) generation++;
      for (const layer of [fill, labels])
        if (map.getLayer(layer))
          map.setLayoutProperty(layer, "visibility", value ? "visible" : "none");
    },
    setOpacity(value) {
      opacity = value;
      if (map.getLayer(fill)) map.setPaintProperty(fill, "fill-opacity", value);
    },
    detach() {
      disposed = true;
      generation++;
      cached = undefined;
      detachSources();
    }
  };
}
