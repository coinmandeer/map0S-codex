import { layerActivity } from "../../tasks/layerActivity";
import { ensureDataPinImage } from "../../map/pinIcons";
import type maplibregl from "maplibre-gl";
import type {
  Bbox,
  FeatureCollection,
  FilterValues,
  GeoFeature,
  GeoThread,
  LayerHandle,
  WorldPage
} from "@mapos/layer-sdk";
import { registerLayer } from "../registry";
import { worldCall } from "../../world/runtime";
import { registerInteractivePins, unregisterInteractivePins } from "../../map/interactivePins";

/**
 * Messages left on the map — the public geo-threads the social world already stores.
 *
 * These are not a second feed: they are the `place`-kind threads whose pins the social map has
 * drawn for a while. This layer is that same data as an ordinary, toggleable catalogue row, so a
 * reader who is not in the game or social overlay can still see "somebody left a note here" on the
 * plain map. Tapping one opens the thread in the existing social panel rather than a new reader.
 *
 * Threads are a social, session-scoped read: the endpoint is behind `credentials: include`, so the
 * layer is capability-agnostic but returns nothing when the caller has no session, and says so.
 */

interface ThreadFeature extends GeoThread {
  lng: number;
  lat: number;
}

const POLL_MS = 30_000;

registerLayer({
  kind: "pins",
  areaFilter: "context",
  manifest: {
    id: "temporary-messages",
    name: "Dočasné zprávy",
    icon: "📣",
    color: "#2563eb",
    category: "community",
    description:
      "Veřejné zprávy zanechané na konkrétním místě. Jsou dočasné a patří do komunitní části MapOS; zobrazují se podle výřezu mapy."
  },
  defaultOpacity: 1,
  create: (ctx) => createMapNotesLayer(ctx.map, ctx.layerId),
  attribution: [{ label: "MapOS komunita", license: "private owner-controlled data" }]
});

function createMapNotesLayer(map: maplibregl.Map, layerId: string): LayerHandle {
  const sourceId = `source-${layerId}`;
  const dotId = `mapnotes-${layerId}-dot`;
  const labelId = `mapnotes-${layerId}-label`;

  let visible = true;
  let opacity = 1;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastBbox: Bbox | null = null;
  let disposed = false;
  let generation = 0;

  function removeAll() {
    if (timer) clearInterval(timer);
    timer = null;
    unregisterInteractivePins(map, [dotId, labelId]);
    for (const id of [labelId, dotId]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }

  function ensureLayers() {
    if (map.getSource(sourceId)) return;
    ensureDataPinImage(map, layerId, "#2563eb");
    map.addSource(sourceId, {
      type: "geojson",
      promoteId: "id",
      data: { type: "FeatureCollection", features: [] }
    });
    map.addLayer({
      id: dotId,
      type: "symbol",
      source: sourceId,
      layout: {
        visibility: visible ? "visible" : "none",
        "icon-image": `pin-${layerId}`,
        "icon-size": 0.9,
        "icon-allow-overlap": true
      },
      paint: { "icon-opacity": opacity }
    });
    map.addLayer({
      id: labelId,
      type: "symbol",
      source: sourceId,
      minzoom: 10,
      layout: {
        visibility: visible ? "visible" : "none",
        "text-field": ["get", "title"],
        "text-size": 11,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
        "text-max-width": 12,
        "text-font": ["Noto Sans Regular"]
      },
      paint: {
        "text-color": "#1e3a8a",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.4,
        "text-opacity": opacity
      }
    });
    registerInteractivePins(map, layerId, [dotId, labelId]);
  }

  async function load(bbox: Bbox) {
    const run = ++generation;
    try {
      const page = await worldCall<WorldPage<GeoThread>>("/threads/search", { bbox });
      if (disposed || run !== generation) return;
      const features: GeoFeature[] = page.items
        .filter((thread) => thread.kind === "place")
        .flatMap((thread) => {
          const at = thread as ThreadFeature;
          if (!Number.isFinite(at.lng) || !Number.isFinite(at.lat)) return [];
          return [
            {
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: [at.lng, at.lat] },
              properties: {
                id: thread.id,
                name: thread.title,
                layerId,
                category: "map-note",
                body: thread.body,
                replies: thread.replies,
                threadId: thread.id
              }
            }
          ];
        });
      layerActivity.state(
        layerId,
        features.length ? "ready" : "empty",
        features.length ? undefined : "V tomto výřezu nejsou veřejné zprávy."
      );
      ensureLayers();
      (map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features
      });
    } catch (error) {
      if (!disposed && run === generation)
        layerActivity.state(
          layerId,
          "error",
          error instanceof Error ? error.message : "Zprávy nelze načíst. Ověř přihlášení a spojení."
        );
    }
  }

  return {
    async update(bbox: Bbox, _filters: FilterValues): Promise<FeatureCollection | null> {
      ensureLayers();
      lastBbox = bbox;
      await load(bbox);
      if (timer) clearInterval(timer);
      // New notes appear while the map sits still, so a slow poll keeps the layer honest without
      // ever hitting the upstream on a pan.
      timer = setInterval(() => {
        if (!disposed && visible && document.visibilityState === "visible" && lastBbox)
          void load(lastBbox);
      }, POLL_MS);
      return null;
    },
    setVisible(next: boolean) {
      visible = next;
      for (const id of [dotId, labelId]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", next ? "visible" : "none");
      }
    },
    setOpacity(next: number) {
      opacity = next;
      if (map.getLayer(dotId)) {
        map.setPaintProperty(dotId, "icon-opacity", 0.9 * next);
      }
      if (map.getLayer(labelId)) map.setPaintProperty(labelId, "text-opacity", next);
    },
    detach() {
      disposed = true;
      generation++;
      removeAll();
    }
  };
}
