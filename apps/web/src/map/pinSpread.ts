import maplibregl from "maplibre-gl";
import type { GeoFeature } from "@mapos/layer-sdk";
import { PIN_STYLES } from "../ui/presets";
import { pinSpreadOffsets } from "./pinSpreadLayout";
import "./pinSpread.css";
export interface SpreadPin {
  layer: string;
  feature: GeoFeature;
}
/** At most twelve temporary buttons and one SVG. No requests or changes to source geometry. */
export function createPinSpread(map: maplibregl.Map, open: (pin: SpreadPin) => void) {
  let markers: maplibregl.Marker[] = [];
  let lines: SVGSVGElement | null = null;
  const hide = () => {
    for (const marker of markers) marker.remove();
    markers = [];
    lines?.remove();
    lines = null;
  };
  const show = (pins: SpreadPin[]) => {
    hide();
    const offsets = pinSpreadOffsets(pins.length);
    if (!offsets.length || pins.some((pin) => pin.feature.geometry.type !== "Point")) return;
    const first = pins[0]!.feature.geometry as GeoJSON.Point;
    const origin = map.project(first.coordinates as [number, number]);
    lines = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    lines.classList.add("pin-spread-lines");
    lines.setAttribute("aria-hidden", "true");
    map.getContainer().append(lines);
    pins.forEach((pin, i) => {
      const [dx, dy] = offsets[i]!;
      const start = map.project(
        (pin.feature.geometry as GeoJSON.Point).coordinates as [number, number]
      );
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(start.x));
      line.setAttribute("y1", String(start.y));
      line.setAttribute("x2", String(origin.x + dx));
      line.setAttribute("y2", String(origin.y + dy));
      lines!.append(line);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pin-spread-button";
      const style = PIN_STYLES[String(pin.feature.properties.category)] ?? PIN_STYLES.default;
      button.textContent = style?.icon ?? "●";
      button.style.setProperty("--pin-color", style?.color ?? "#64748b");
      button.title = String(pin.feature.properties.name ?? "Místo");
      button.setAttribute("aria-label", button.title);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        hide();
        open(pin);
      });
      markers.push(
        new maplibregl.Marker({ element: button })
          .setLngLat(map.unproject([origin.x + dx, origin.y + dy]))
          .addTo(map)
      );
    });
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape") hide();
  };
  map.on("movestart", hide);
  map.on("style.load", hide);
  document.addEventListener("keydown", escape);
  return {
    show,
    hide,
    destroy() {
      hide();
      map.off("movestart", hide);
      map.off("style.load", hide);
      document.removeEventListener("keydown", escape);
    }
  };
}
