import type maplibregl from "maplibre-gl";
import type { Bbox, FeatureCollection, FilterValues, LayerHandle } from "@mapos/layer-sdk";

export interface TileLayerSpec {
  /** One entry per subdomain. MapLibre has no `{s}` placeholder, so `a/b/c` mirrors are listed
   *  explicitly — which is also what lets it spread requests across them. */
  tiles: string[];
  tileSize?: number;
  minzoom?: number;
  maxzoom?: number;
  bounds?: [number, number, number, number];
  /** Shown in the map's attribution control. Most of these tile servers require it. */
  attribution?: string;
  /** Lets a filter change the tile set, e.g. Waymarked Trails' hiking vs cycling routes.
   *  Returning the same URLs is free — the handle only rebuilds when they actually differ. */
  sourcesForFilters?(filters: FilterValues): { id: string; tiles: string[] }[];
  tilesForFilters?(filters: FilterValues): string[];
}

/**
 * Builds a raster overlay handle. Tile layers are the cheapest kind of layer to add — a URL
 * template and an attribution — so they get a factory instead of a module each.
 *
 * Overlays are inserted below the basemap's first symbol layer. That keeps place labels and pin
 * icons on top of the overlay, which matters more than the double labelling you get on the few
 * tile sets that draw their own.
 */
export function createTileLayer(
  map: maplibregl.Map,
  layerId: string,
  spec: TileLayerSpec
): LayerHandle {
  if (spec.sourcesForFilters) {
    const children = new Map<string, LayerHandle>();
    const childTiles = new Map<string, string>();
    let visible = true;
    let opacity = 1;
    let generation = 0;
    let detached = false;
    return {
      async update(bbox, filters, signal) {
        const run = ++generation;
        if (detached || signal?.aborted) return null;
        const sources = spec.sourcesForFilters!(filters);
        const wanted = new Set(sources.map((source) => source.id));
        for (const [id, child] of children)
          if (!wanted.has(id)) {
            child.detach();
            children.delete(id);
            childTiles.delete(id);
          }
        for (const source of sources) {
          if (detached || signal?.aborted || run !== generation) return null;
          let child = children.get(source.id);
          const signature = JSON.stringify(source.tiles);
          if (child && childTiles.get(source.id) !== signature) {
            child.detach();
            children.delete(source.id);
            child = undefined;
          }
          if (!child) {
            child = createTileLayer(map, `${layerId}-${source.id}`, {
              ...spec,
              tiles: source.tiles,
              sourcesForFilters: undefined,
              tilesForFilters: undefined
            });
            child.setVisible(visible);
            child.setOpacity(opacity);
            children.set(source.id, child);
            childTiles.set(source.id, signature);
          }
          await child.update(bbox, filters, signal);
        }
        return null;
      },
      setVisible(value) {
        visible = value;
        for (const child of children.values()) child.setVisible(value);
      },
      setOpacity(value) {
        opacity = value;
        for (const child of children.values()) child.setOpacity(value);
      },
      detach() {
        detached = true;
        generation++;
        for (const child of children.values()) child.detach();
        children.clear();
        childTiles.clear();
      }
    };
  }
  const sourceId = `source-tile-${layerId}`;
  const rasterId = `raster-tile-${layerId}`;

  let currentTiles: string[] = [];
  let detached = false;
  let visible = true;
  let opacity = 1;

  function firstSymbolLayerId(): string | undefined {
    return map.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
  }

  function ensureLayer(tiles: string[]) {
    // A style switch (theme or provider) wipes runtime layers, so presence is re-checked rather
    // than tracked — same contract every other layer module here follows.
    const sameTiles =
      tiles.length === currentTiles.length && tiles.every((t, i) => t === currentTiles[i]);
    if (sameTiles && map.getSource(sourceId) && map.getLayer(rasterId)) return;

    if (map.getLayer(rasterId)) map.removeLayer(rasterId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    map.addSource(sourceId, {
      type: "raster",
      tiles,
      tileSize: spec.tileSize ?? 256,
      minzoom: spec.minzoom ?? 0,
      maxzoom: spec.maxzoom ?? 19,
      ...(spec.bounds ? { bounds: spec.bounds } : {}),
      attribution: spec.attribution
    });
    map.addLayer(
      {
        id: rasterId,
        type: "raster",
        source: sourceId,
        minzoom: spec.minzoom ?? 0,
        layout: { visibility: visible ? "visible" : "none" },
        paint: { "raster-opacity": opacity }
      },
      firstSymbolLayerId()
    );
    currentTiles = tiles;
  }

  return {
    async update(
      _bbox: Bbox,
      filters: FilterValues,
      signal?: AbortSignal
    ): Promise<FeatureCollection | null> {
      if (detached || signal?.aborted) return null;
      ensureLayer(spec.tilesForFilters?.(filters) ?? spec.tiles);
      // Tiles are fetched by MapLibre, so there is nothing for the results list or the cache.
      return null;
    },
    setVisible(next: boolean) {
      visible = next;
      if (map.getLayer(rasterId)) {
        map.setLayoutProperty(rasterId, "visibility", next ? "visible" : "none");
      }
    },
    setOpacity(next: number) {
      opacity = next;
      if (map.getLayer(rasterId)) map.setPaintProperty(rasterId, "raster-opacity", next);
    },
    detach() {
      detached = true;
      if (map.getLayer(rasterId)) map.removeLayer(rasterId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      currentTiles = [];
    }
  };
}

/** `a`/`b`/`c` subdomain expansion, the shape almost every OSM-family tile server uses. */
export function subdomains(template: string, hosts = ["a", "b", "c"]): string[] {
  return hosts.map((h) => template.replace("{s}", h));
}
