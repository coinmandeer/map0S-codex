import maplibregl from "maplibre-gl";
import type { LayerHandle } from "@mapos/layer-sdk";
import { createVectorTileOverlay } from "../vectorTileOverlay";

/**
 * Territories coloured by a value.
 *
 * The colouring is a `step` expression over the class breaks the server computed, not a
 * continuous interpolation. Five classes is what a legend can be read against: with a gradient,
 * a reader can see that one region is darker than another but cannot say what either value is,
 * which is the failure mode of most thematic maps.
 *
 * Two details carry most of the weight. Territories with no value are drawn with a hatch rather
 * than left blank, because blank is indistinguishable from "the overlay is off" — the pattern
 * says "asked, and there is nothing" (§23.2). And the fill is drawn under the basemap's symbol
 * layers, so place labels stay legible over it; a choropleth that hides the map it explains is
 * worse than no choropleth.
 */

export interface ChoroplethBreak {
  from: number;
  to: number;
  color: string;
}

export interface ChoroplethSpec {
  tiles: string[];
  /** The layer inside the tile; the theme endpoint always names it `units`. */
  sourceLayer: string;
  /** The feature property holding the number. */
  valueProperty?: string;
  breaks: readonly ChoroplethBreak[];
  minzoom?: number;
  maxzoom?: number;
  attribution?: string;
  unit?: string;
}

/** The id the hatch pattern is registered under, per map instance. */
const NO_DATA_PATTERN = "mapos-no-data-hatch";

export const NO_DATA_COLOR = "#9aa0a6";

/**
 * `step` wants: default, then (stop, output) pairs ascending.
 *
 * The first class doubles as the default so a value below the lowest break — which happens
 * whenever a later import lowers the minimum — is coloured rather than dropped.
 */
export function fillColorExpression(
  breaks: readonly ChoroplethBreak[],
  valueProperty = "value"
): maplibregl.ExpressionSpecification | string {
  if (!breaks.length) return NO_DATA_COLOR;
  const steps: unknown[] = ["step", ["to-number", ["get", valueProperty], -1], breaks[0]!.color];
  for (const entry of breaks.slice(1)) {
    steps.push(entry.from, entry.color);
  }
  // A missing value coerces to the sentinel, and the case expression below is what keeps it
  // from being painted as if it were the lowest class.
  return [
    "case",
    ["==", ["get", valueProperty], null],
    NO_DATA_COLOR,
    steps as maplibregl.ExpressionSpecification
  ] as unknown as maplibregl.ExpressionSpecification;
}

/** A 45° hatch, drawn once into a canvas and handed to MapLibre as an image. */
export function ensureNoDataPattern(map: maplibregl.Map): string | null {
  if (map.hasImage(NO_DATA_PATTERN)) return NO_DATA_PATTERN;
  const size = 8;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.strokeStyle = "rgba(120, 128, 136, 0.55)";
  context.lineWidth = 1.4;
  context.beginPath();
  context.moveTo(0, size);
  context.lineTo(size, 0);
  context.moveTo(-1, 1);
  context.lineTo(1, -1);
  context.moveTo(size - 1, size + 1);
  context.lineTo(size + 1, size - 1);
  context.stroke();
  const image = context.getImageData(0, 0, size, size);
  map.addImage(NO_DATA_PATTERN, {
    width: size,
    height: size,
    data: new Uint8Array(image.data.buffer)
  });
  return NO_DATA_PATTERN;
}

export function createChoroplethLayer(
  map: maplibregl.Map,
  layerId: string,
  spec: ChoroplethSpec
): LayerHandle {
  const valueProperty = spec.valueProperty ?? "value";
  const pattern = ensureNoDataPattern(map);

  const handle = createVectorTileOverlay(map, layerId, {
    tiles: spec.tiles,
    minzoom: spec.minzoom,
    maxzoom: spec.maxzoom,
    attribution: spec.attribution,
    sublayers: [
      {
        id: "fill",
        type: "fill",
        sourceLayer: spec.sourceLayer,
        filter: ["!=", ["get", valueProperty], null],
        paint: {
          "fill-color": fillColorExpression(spec.breaks, valueProperty),
          // Opaque enough to read as a class, sheer enough to keep the terrain underneath.
          "fill-opacity": 0.72
        }
      },
      {
        id: "nodata",
        type: "fill",
        sourceLayer: spec.sourceLayer,
        filter: ["==", ["get", valueProperty], null],
        paint: pattern
          ? { "fill-pattern": pattern, "fill-opacity": 0.9 }
          : { "fill-color": NO_DATA_COLOR, "fill-opacity": 0.25 }
      },
      {
        id: "hover",
        type: "line",
        sourceLayer: spec.sourceLayer,
        filter: ["==", ["get", "code"], ""],
        paint: { "line-color": "#f8fafc", "line-width": 3 }
      },
      {
        id: "outline",
        type: "line",
        sourceLayer: spec.sourceLayer,
        paint: {
          "line-color": "rgba(255, 255, 255, 0.65)",
          "line-width": 0.6,
          "line-opacity": 0.8
        }
      }
    ]
  });
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
  const hover = (event: maplibregl.MapLayerMouseEvent) => {
    const p = event.features?.[0]?.properties;
    if (!p) return;
    const label = document.createElement("div");
    label.textContent = `${p.name ?? p.code} · ${p.value == null ? "—" : Number(p.value).toLocaleString()} ${spec.unit ?? ""} · ${p.period ?? "—"}${p.flag ? ` (${p.flag})` : ""}`;
    popup.setLngLat(event.lngLat).setDOMContent(label).addTo(map);
    const line = `vt-${layerId}-hover`;
    if (map.getLayer(line)) map.setFilter(line, ["==", ["get", "code"], String(p.code)]);
  };
  const leave = () => {
    popup.remove();
    const line = `vt-${layerId}-hover`;
    if (map.getLayer(line)) map.setFilter(line, ["==", ["get", "code"], ""]);
  };
  for (const suffix of ["fill", "nodata"]) {
    map.on("mousemove", `vt-${layerId}-${suffix}`, hover);
    map.on("mouseleave", `vt-${layerId}-${suffix}`, leave);
  }
  return {
    ...handle,
    setVisible(visible) {
      if (!visible) leave();
      handle.setVisible(visible);
    },
    detach() {
      leave();
      for (const suffix of ["fill", "nodata"]) {
        map.off("mousemove", `vt-${layerId}-${suffix}`, hover);
        map.off("mouseleave", `vt-${layerId}-${suffix}`, leave);
      }
      handle.detach();
    }
  };
}
