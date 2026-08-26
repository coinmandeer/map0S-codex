import type maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import type { DataProvider } from "@mapos/layer-sdk";
import type { ThemeMode } from "../store/mapStore";
import { API_BASE } from "../lib/api";
import { CARTO_DARK_MATTER_URL, CARTO_VOYAGER_URL, mapyStyle } from "./mapStyle";

/** The base map style follows the user's light/dark theme toggle directly (like the
 * followable reference design) rather than being tied to the POI/weather/game mode.
 *
 * Two provider families, two shapes: OSM returns a style *URL* string that MapLibre fetches
 * and caches itself, Mapy returns an inline style object pointing at our tile proxy. MapLibre
 * accepts either from `setStyle`, so callers don't have to care which they got. */
export function styleForProvider(
  theme: ThemeMode,
  provider: DataProvider
): string | StyleSpecification {
  if (provider === "mapy") {
    // Outdoor is the mapset that makes Mapy worth switching to: trail markings, contour lines
    // and hiking infrastructure that neither CARTO style carries.
    return mapyStyle(API_BASE, "outdoor", theme);
  }
  return theme === "dark" ? CARTO_DARK_MATTER_URL : CARTO_VOYAGER_URL;
}

export function styleUrlForTheme(theme: ThemeMode): string | StyleSpecification {
  return styleForProvider(theme, "osm");
}

/** Swaps the base map style. Any runtime-added layers (pins, radar, the game custom-gl layer)
 * get wiped by the style change like any other setStyle call — each layer module re-checks
 * `map.getSource(...)`/`map.getLayer(...)` presence on its next update() and transparently
 * re-creates itself, so no extra teardown bookkeeping is needed here beyond re-triggering a
 * refresh (done by MapCore's style.load handler). */
export function applyMapStyle(map: maplibregl.Map, theme: ThemeMode, provider: DataProvider) {
  map.setStyle(styleForProvider(theme, provider));
}

/** Mapy's licence requires their logo to stay visible on the map whenever their tiles are
 *  shown. It is removed again the moment the provider switches away. */
export class MapyLogoControl implements maplibregl.IControl {
  private container: HTMLDivElement | null = null;

  onAdd(): HTMLElement {
    const el = document.createElement("div");
    el.className = "maplibregl-ctrl mapy-logo-ctrl";
    const link = document.createElement("a");
    link.href = "https://mapy.com/";
    link.target = "_blank";
    link.rel = "noopener";
    link.setAttribute("aria-label", "Mapy.com");
    const img = document.createElement("img");
    img.src = "https://api.mapy.com/img/api/logo.svg";
    img.alt = "Mapy.com";
    img.width = 68;
    img.height = 18;
    link.appendChild(img);
    el.appendChild(link);
    this.container = el;
    return el;
  }

  onRemove() {
    this.container?.remove();
    this.container = null;
  }
}
