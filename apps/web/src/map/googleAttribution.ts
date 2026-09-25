import { googleMaximumZoom } from "./googleZoom";
import "./googleAttribution.css";
import type { Map, IControl } from "maplibre-gl";
import { API_BASE } from "../lib/api";
/** Isolated basemap attribution: never mixes Google credits with overlay data sources. */
export class GoogleAttributionControl implements IControl {
  private map: Map | null = null;
  private element = document.createElement("div");
  private copyright = document.createElement("span");
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private mapset = "";
  private originalMaxZoom = 22;
  constructor(private unavailable: () => void) {
    this.element.className = "maplibregl-ctrl google-map-attribution";
    const brand = document.createElement("a");
    brand.href = "https://maps.google.com";
    brand.target = "_blank";
    brand.rel = "noreferrer";
    brand.textContent = "Google Maps";
    brand.setAttribute("aria-label", "Google Maps — mapový podklad");
    this.element.append(brand, this.copyright);
  }
  onAdd(map: Map) {
    this.map = map;
    this.originalMaxZoom = map.getMaxZoom();
    map.on("moveend", this.schedule);
    this.schedule();
    return this.element;
  }
  onRemove() {
    this.map?.setMaxZoom(this.originalMaxZoom);
    this.map?.off("moveend", this.schedule);
    this.abort?.abort();
    if (this.timer) clearTimeout(this.timer);
    this.map = null;
    this.element.remove();
  }
  setMapset(mapset: string) {
    if (this.mapset !== mapset) {
      this.mapset = mapset;
      this.map?.setMaxZoom(this.originalMaxZoom);
      this.copyright.textContent = "";
      this.schedule();
    }
  }
  private schedule = () => {
    if (this.timer) clearTimeout(this.timer);
    this.abort?.abort();
    this.timer = setTimeout(() => void this.refresh(), 250);
  };
  private async refresh() {
    const map = this.map;
    if (!map || !this.mapset) return;
    const controller = new AbortController();
    this.abort = controller;
    const bounds = map.getBounds(),
      wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
    const full = bounds.getEast() - bounds.getWest() >= 360;
    const bbox = [
      full ? -179.999999 : wrap(bounds.getWest()),
      Math.max(-89.999999, bounds.getSouth()),
      full ? 179.999999 : wrap(bounds.getEast()),
      Math.min(89.999999, bounds.getNorth())
    ];
    try {
      const params = new URLSearchParams({
        mapset: this.mapset,
        bbox: bbox.join(","),
        zoom: String(Math.min(22, Math.max(0, Math.floor(map.getZoom()))))
      });
      const response = await fetch(`${API_BASE}/basemap/google/viewport?${params}`, {
        signal: controller.signal
      });
      if (!response.ok) throw new Error("Attribution unavailable");
      const result = (await response.json()) as { copyright?: string; maxZoomRects?: unknown[] };
      if (typeof result.copyright !== "string" || !result.copyright.trim())
        throw new Error("Missing attribution");
      if (!controller.signal.aborted) {
        this.copyright.textContent = result.copyright;
        const center = map.getCenter();
        map.setMaxZoom(
          googleMaximumZoom(result.maxZoomRects, wrap(center.lng), center.lat, this.originalMaxZoom)
        );
      }
    } catch {
      if (!controller.signal.aborted && this.map === map) this.unavailable();
    }
  }
}
