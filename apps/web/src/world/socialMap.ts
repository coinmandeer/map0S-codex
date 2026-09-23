import { suppressContextClick } from "../map/contextGesture";
import { attachPressGesture } from "../map/pressGesture";
import { getShellStore } from "../store/shellStore";
import { emit, on } from "../lib/events";
import maplibregl from "maplibre-gl";
import type { GeoThread, WorldPage } from "@mapos/layer-sdk";
import { getMapStore } from "../store/mapStore";
import { worldCall, worldRuntime } from "./runtime";

/** The social overlay shares the real map and works without the game renderer. */
export function attachSocialMap(map: maplibregl.Map) {
  const markers = new Map<string, maplibregl.Marker>();
  let timer: ReturnType<typeof setTimeout> | undefined,
    disposed = false,
    generation = 0,
    filterKey = "";
  const bounds = () => {
    const b = map.getBounds();
    const box: [number, number, number, number] = [
      Math.max(-180, b.getWest()),
      Math.max(-85, b.getSouth()),
      Math.min(180, b.getEast()),
      Math.min(85, b.getNorth())
    ];
    worldRuntime.patch({ bbox: box });
    return box;
  };
  const render = () => {
    if (!map.isStyleLoaded()) return;
    const state = worldRuntime.get(),
      game = getMapStore().mode === "game";
    const visible = state.socialOpen || game || state.visible;
    const notes = visible ? state.notes : [];
    for (const [id, marker] of markers)
      if (game || !notes.some((t) => t.id === id)) {
        marker.remove();
        markers.delete(id);
      }
    if (!game)
      for (const thread of notes) {
        if (markers.has(thread.id)) continue;
        const button = document.createElement("button");
        button.className = "world-map-beacon";
        button.textContent = `▤ ${thread.replies}`;
        button.title = thread.title;
        button.setAttribute("aria-label", `Otevřít zprávu: ${thread.title}`);
        button.onclick = (e) => {
          e.stopPropagation();
          worldRuntime.openThread(thread.id);
        };
        markers.set(
          thread.id,
          new maplibregl.Marker({ element: button }).setLngLat([thread.lng, thread.lat]).addTo(map)
        );
      }
    const filter = state.socialOpen ? state.geoFilter : null;
    const key = JSON.stringify(filter);
    if (key === filterKey && map.getSource("world-social-radius")) return;
    filterKey = key;
    const coordinates: number[][] = [];
    if (filter)
      for (let i = 0; i <= 64; i++) {
        const angle = (i / 64) * Math.PI * 2;
        coordinates.push([
          filter.lng +
            (Math.cos(angle) * filter.radius) / (111320 * Math.cos((filter.lat * Math.PI) / 180)),
          filter.lat + (Math.sin(angle) * filter.radius) / 111320
        ]);
      }
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: filter
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Polygon", coordinates: [coordinates] }
            }
          ]
        : []
    };
    const source = map.getSource("world-social-radius") as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      map.addSource("world-social-radius", { type: "geojson", data });
      map.addLayer({
        id: "world-social-radius-fill",
        type: "fill",
        source: "world-social-radius",
        paint: { "fill-color": "#9662e5", "fill-opacity": 0.055 }
      });
      map.addLayer({
        id: "world-social-radius-line",
        type: "line",
        source: "world-social-radius",
        paint: {
          "line-color": "#9662e5",
          "line-width": 1.5,
          "line-dasharray": [3, 3],
          "line-opacity": 0.7
        }
      });
    }
  };
  const refresh = async () => {
    const state = worldRuntime.get(),
      store = getMapStore();
    if (disposed || !store.session || !(state.socialOpen || store.mode === "game" || state.visible))
      return;
    const gen = ++generation;
    try {
      const page = await worldCall<WorldPage<GeoThread>>("/threads/search", { bbox: bounds() });
      if (!disposed && generation === gen)
        worldRuntime.patch({ notes: page.items.filter((t) => t.kind === "place") });
    } catch {
      /* Keep already loaded public points on transient network failures. */
    }
  };
  const moved = () => {
    bounds();
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 750);
  };
  let pointMarker: maplibregl.Marker | null = null;
  const gesture = attachPressGesture(
    map.getCanvas(),
    (x, y) => {
      const lngLat = map.unproject([x, y]);
      pointMarker?.remove();
      pointMarker = new maplibregl.Marker({ color: "#2563eb" }).setLngLat(lngLat).addTo(map);
      emit("map-place-context", { lng: lngLat.lng, lat: lngLat.lat, x, y });
    },
    () => suppressContextClick(map),
    () =>
      getMapStore().mode !== "game" &&
      !getMapStore().editMode &&
      getShellStore().snapshot.mapPicker.type !== "active"
  );
  const offPoint = on("map-place-context", (point) => {
    if (!point) {
      pointMarker?.remove();
      pointMarker = null;
    }
  });
  const off = worldRuntime.subscribe(render),
    interval = setInterval(() => void refresh(), 15000);
  map.on("moveend", moved);
  map.on("style.load", render);
  map.on("movestart", gesture.cancel);
  bounds();
  void refresh();
  return () => {
    disposed = true;
    generation++;
    clearInterval(interval);
    clearTimeout(timer);
    gesture.detach();
    offPoint();
    off();
    map.off("moveend", moved);
    map.off("style.load", render);
    pointMarker?.remove();
    map.off("movestart", gesture.cancel);
    for (const m of markers.values()) m.remove();
  };
}
