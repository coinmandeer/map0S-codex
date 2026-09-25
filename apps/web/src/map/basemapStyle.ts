import type { StyleSpecification } from "maplibre-gl";
import type { BasemapDefinition, LabelOverlayDefinition } from "@mapos/layer-sdk";
import { basemapById, DEFAULT_BASEMAP_ID, labelOverlayFor } from "@mapos/layer-sdk";
import type { ThemeMode } from "../store/mapStore";
import { RASTER_STYLE_GLYPHS } from "./mapStyle";

/**
 * Turns a chosen background into something MapLibre will render.
 *
 * Three shapes come out of here, and callers don't need to know which: a style URL string for
 * keyless vector maps (MapLibre fetches and caches those itself), or an inline style built
 * around raster tiles — either straight from the upstream or through our key-holding proxy.
 * Imagery gets a label overlay stacked on top, because an aerial photo without place names is
 * pretty and useless for finding anything.
 */

export interface BasemapContext {
  theme: ThemeMode;
  apiBase: string;
  /** Draw place names over imagery. Ignored for backgrounds that have their own labels. */
  labels: boolean;
  capabilities: Record<string, boolean | string> | null;
}

function proxyTiles(apiBase: string, provider: string, mapset: string): string[] {
  return [`${apiBase}/basemap/${provider}/${mapset}/{z}/{x}/{y}?retina=1`];
}

export function tilesFor(
  entry: { tiles?: string[]; proxy?: { provider: string; mapset: string } },
  apiBase: string,
  capabilities: Record<string, boolean | string> | null = null
): string[] {
  if (entry.proxy?.provider === "maptiler") {
    const key = capabilities?.maptilerPublicKey;
    if (typeof key === "string" && key) {
      const mapset = entry.proxy.mapset;
      return mapset === "satellite-v2"
        ? [
            `https://api.maptiler.com/tiles/${mapset}/{z}/{x}/{y}.jpg?key=${encodeURIComponent(key)}`
          ]
        : [
            `https://api.maptiler.com/maps/${mapset}/{z}/{x}/{y}@2x.png?key=${encodeURIComponent(key)}`
          ];
    }
  }
  if (entry.proxy) return proxyTiles(apiBase, entry.proxy.provider, entry.proxy.mapset);
  return entry.tiles ?? [];
}

/** The background actually shown for a chosen id. A light design paired with a dark theme swaps
 *  to its dark twin, which is how the CARTO pair behaved before backgrounds were selectable. */
export function resolveBasemap(id: string, theme: ThemeMode): BasemapDefinition {
  const chosen = basemapById(id) ?? basemapById(DEFAULT_BASEMAP_ID)!;
  if (theme !== "dark" || !chosen.darkVariantId) return chosen;
  return basemapById(chosen.darkVariantId) ?? chosen;
}

export function overlayForBasemap(
  basemap: BasemapDefinition,
  ctx: Pick<BasemapContext, "labels" | "capabilities">
): LabelOverlayDefinition | null {
  if (!ctx.labels) return null;
  return labelOverlayFor(basemap, ctx.capabilities);
}

export function styleForBasemap(
  basemap: BasemapDefinition,
  ctx: BasemapContext
): string | StyleSpecification {
  const overlay = overlayForBasemap(basemap, ctx);

  // A vector style is a complete design of its own; the only reason to inline it would be to
  // stack labels on imagery, and vector backgrounds already carry theirs.
  if (basemap.styleUrl && !overlay) return basemap.styleUrl;

  const tiles = tilesFor(basemap, ctx.apiBase, ctx.capabilities);
  const layers: StyleSpecification["layers"] = [
    {
      id: "background",
      type: "background",
      paint: { "background-color": ctx.theme === "dark" ? "#0d0d0d" : "#f8f5ef" }
    },
    {
      id: "basemap-raster",
      type: "raster",
      source: "basemap",
      // Photographic backgrounds are left alone: dimming imagery makes it look broken rather
      // than dark. Drawn maps are designed for a white page, so they get a nudge instead.
      paint: basemap.imagery
        ? {}
        : ctx.theme === "dark"
          ? { "raster-brightness-max": 0.82, "raster-saturation": -0.12 }
          : { "raster-saturation": 0.04 }
    }
  ];

  const sources: StyleSpecification["sources"] = {
    basemap: {
      type: "raster",
      tiles,
      tileSize: basemap.tileSize ?? 256,
      ...(basemap.bounds ? { bounds: basemap.bounds } : {}),
      ...(basemap.minzoom != null ? { minzoom: basemap.minzoom } : {}),
      maxzoom: basemap.maxzoom ?? 19,
      attribution: basemap.attribution.map((a) => a.label).join(", ")
    }
  };

  if (overlay) {
    const overlayTiles =
      ctx.theme === "dark" && overlay.darkTiles
        ? overlay.darkTiles
        : tilesFor(overlay, ctx.apiBase, ctx.capabilities);
    sources.labels = {
      type: "raster",
      tiles: overlayTiles,
      tileSize: 256,
      maxzoom: 19,
      attribution: overlay.attribution.map((a) => a.label).join(", ")
    };
    layers.push({ id: "basemap-labels", type: "raster", source: "labels" });
  }

  return { version: 8, name: basemap.label, glyphs: RASTER_STYLE_GLYPHS, sources, layers };
}
