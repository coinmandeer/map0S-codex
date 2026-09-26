import { ensureDataPinImage } from "../map/pinIcons";
import type maplibregl from "maplibre-gl";
import type {
  Bbox,
  FeatureCollection,
  FilterValues,
  GeoFeature,
  LayerHandle
} from "@mapos/layer-sdk";
import type { SatRec } from "satellite.js";
import { emit } from "../lib/events";
import { registerInteractivePins, unregisterInteractivePins } from "../map/interactivePins";

/**
 * Satellites, propagated in the browser with SGP4.
 *
 * The plan's requirement is that switching the layer on shows the satellites' tracks and where
 * they are right now, filterable by category. The API therefore returns orbital elements, not
 * positions: a position is only true for one instant, and asking the server for a fresh one every
 * second would be both wasteful and laggy.
 *
 * Two sources, because the two halves change at completely different rates:
 *
 *  - the **ground track** is a line of positions over a window. It changes only when the set of
 *    satellites changes, so it is rebuilt when the category filter changes and then refreshed
 *    occasionally — never once a second.
 *  - the **dot** is where the satellite is right now. That is the only thing recomputed on the
 *    one-second tick, and it is a single SGP4 evaluation per satellite.
 *
 * Cost is bounded: the number of satellites is capped by the API, and the whole set is propagated
 * on one interval, not one timer per satellite.
 */

const TRACK_MINUTES = 90;
const TRACK_STEP_SECONDS = 120;
const TICK_MS = 1000;
/** Tracks are redrawn on this cadence, not every tick: the drawn window is 90 minutes long, so a
 *  few seconds of staleness in the line is invisible while a full rebuild every second is not. */
const TRACK_REFRESH_MS = 60_000;

interface SatelliteElement {
  id: string;
  name: string;
  category: string;
  epoch: string;
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  raOfAscNode: number;
  argOfPericenter: number;
  meanAnomaly: number;
  bstar: number;
  meanMotionDot: number;
  meanMotionDdot: number;
  noradCatId: number;
}

interface SatelliteCatalogResponse {
  elements: SatelliteElement[];
  epoch: string | null;
  source: { label: string; url: string; license: string };
  unavailable: string[];
}

/** Category → colour, one hue per family so the map reads at a glance. Kept in sync with the
 *  layer's legend; a category outside this map falls back to the satellite blue. */
export const SATELLITE_CATEGORY_COLORS: Record<string, string> = {
  stations: "#f59e0b",
  starlink: "#8b5cf6",
  oneweb: "#6366f1",
  gps: "#22c55e",
  glonass: "#16a34a",
  galileo: "#0ea5e9",
  beidou: "#14b8a6",
  gnss: "#4ade80",
  geo: "#eab308",
  weather: "#0284c7",
  resource: "#a3e635",
  planet: "#84cc16",
  iridium: "#f472b6",
  globalstar: "#fb923c",
  communication: "#38bdf8",
  science: "#a855f7",
  military: "#64748b",
  sarsat: "#ef4444",
  tdrss: "#facc15",
  amateur: "#ec4899",
  visual: "#fde047",
  cubesat: "#94a3b8",
  engineering: "#22d3ee",
  education: "#4ade80",
  radar: "#dc2626"
};

function colorFor(category: string): string {
  return SATELLITE_CATEGORY_COLORS[category] ?? "#38bdf8";
}

/** SGP4 is about 100 kB of the app and only this layer needs it, so it arrives with the layer's
 *  first update instead of with the map. */
let sgp4: typeof import("satellite.js") | null = null;
let sgp4Loading: Promise<typeof import("satellite.js")> | null = null;
export function loadSatelliteMath(): Promise<typeof import("satellite.js")> {
  sgp4Loading ??= import("satellite.js").then(
    (module) => (sgp4 = module),
    (error) => {
      sgp4Loading = null;
      throw error;
    }
  );
  return sgp4Loading;
}

/** A satellite's position at an instant, or null when SGP4 cannot produce a sane one. */
function positionAt(
  satrec: SatRec,
  at: Date
): { lng: number; lat: number; altitudeKm: number } | null {
  if (!sgp4) return null;
  const { eciToGeodetic, gstime, propagate } = sgp4;
  const pv = propagate(satrec, at);
  const position = pv?.position;
  if (
    !position ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z)
  ) {
    return null;
  }
  const geodetic = eciToGeodetic(position, gstime(at));
  const lat = (geodetic.latitude * 180) / Math.PI;
  const lng = (geodetic.longitude * 180) / Math.PI;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lng: ((lng + 540) % 360) - 180,
    lat,
    altitudeKm: Number.isFinite(geodetic.height) ? geodetic.height : 0
  };
}

/** The ground track over a window, split at the antimeridian.
 *
 *  Without the split a satellite crossing ±180° draws a single line straight across the whole map
 *  from one edge to the other — the track would look like a scar, not an orbit. Each continuous
 *  run between crossings becomes its own LineString. */
export function groundTracks(
  satrec: SatRec,
  from: Date,
  to: Date,
  identity: { id: string; name: string; layerId: string; color: string },
  stepSeconds = TRACK_STEP_SECONDS
): GeoFeature[] {
  const runs: [number, number][][] = [];
  let current: [number, number][] = [];
  let previousLng: number | null = null;

  for (let t = from.getTime(); t <= to.getTime(); t += stepSeconds * 1000) {
    const point = positionAt(satrec, new Date(t));
    if (!point) continue;
    if (previousLng !== null && Math.abs(point.lng - previousLng) > 180) {
      if (current.length >= 2) runs.push(current);
      current = [];
    }
    current.push([point.lng, point.lat]);
    previousLng = point.lng;
  }
  if (current.length >= 2) runs.push(current);

  return runs.map((coordinates, index) => ({
    type: "Feature" as const,
    geometry: {
      type: "LineString" as const,
      coordinates: coordinates as [[number, number], ...Array<[number, number]>]
    },
    properties: {
      id: `${identity.id}:track:${index}`,
      name: identity.name,
      layerId: identity.layerId,
      kind: "track",
      color: identity.color
    }
  }));
}

export function createSatelliteLayer(
  map: maplibregl.Map,
  apiBaseUrl: string,
  layerId: string
): LayerHandle {
  const trackSourceId = `source-sat-tracks-${layerId}`;
  const dotSourceId = `source-sat-dots-${layerId}`;
  const trackId = `sat-${layerId}-track`;
  const dotId = `sat-${layerId}-dot`;
  const labelId = `sat-${layerId}-label`;

  let visible = true;
  let opacity = 1;
  let elements: SatelliteElement[] = [];
  let satrecs: Array<{ element: SatelliteElement; satrec: SatRec | null }> = [];
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let trackTimer: ReturnType<typeof setInterval> | null = null;
  let categories: string[] = [];
  let currentFilterKey = "";
  let disposed = false;
  let firstTrackAt = 0;
  let initialized = false;

  function stopTimers() {
    if (tickTimer) clearInterval(tickTimer);
    if (trackTimer) clearInterval(trackTimer);
    tickTimer = null;
    trackTimer = null;
  }

  function removeAll() {
    stopTimers();
    unregisterInteractivePins(map, [dotId, labelId]);
    for (const id of [labelId, dotId, trackId]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(trackSourceId)) map.removeSource(trackSourceId);
    if (map.getSource(dotSourceId)) map.removeSource(dotSourceId);
  }

  function buildSatrecs() {
    const json2satrec = sgp4?.json2satrec;
    satrecs = elements.map((element) => {
      if (!json2satrec) return { element, satrec: null };
      try {
        const satrec = json2satrec({
          OBJECT_NAME: element.name,
          OBJECT_ID: element.id,
          EPOCH: element.epoch,
          MEAN_MOTION: element.meanMotion,
          ECCENTRICITY: element.eccentricity,
          INCLINATION: element.inclination,
          RA_OF_ASC_NODE: element.raOfAscNode,
          ARG_OF_PERICENTER: element.argOfPericenter,
          MEAN_ANOMALY: element.meanAnomaly,
          BSTAR: element.bstar,
          MEAN_MOTION_DOT: element.meanMotionDot,
          MEAN_MOTION_DDOT: element.meanMotionDdot,
          NORAD_CAT_ID: element.noradCatId
        } as never) as SatRec;
        return { element, satrec: satrec?.error === 0 ? satrec : null };
      } catch {
        // One satellite whose elements SGP4 rejects must not take the whole layer with it.
        return { element, satrec: null };
      }
    });
  }

  function chosenSatrecs(): Array<{ element: SatelliteElement; satrec: SatRec }> {
    const chosen = new Set(categories);
    return satrecs.flatMap(({ element, satrec }) => {
      if (!satrec || (chosen.size && !chosen.has(element.category))) return [];
      return [{ element, satrec }];
    });
  }

  function ensureLayers() {
    if (!map.getSource(trackSourceId)) {
      map.addSource(trackSourceId, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      map.addLayer({
        id: trackId,
        type: "line",
        source: trackSourceId,
        layout: { visibility: visible ? "visible" : "none", "line-cap": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 1.4,
          "line-opacity": 0.5 * opacity,
          "line-dasharray": [2, 2]
        }
      });
    }
    if (!map.getSource(dotSourceId)) {
      for (const [category, color] of Object.entries(SATELLITE_CATEGORY_COLORS))
        ensureDataPinImage(map, `satellite-${category}`, color, "satellite");
      ensureDataPinImage(map, "satellite-default", "#38bdf8", "satellite");
      map.addSource(dotSourceId, {
        type: "geojson",
        promoteId: "id",
        data: { type: "FeatureCollection", features: [] }
      });
      map.addLayer({
        id: dotId,
        type: "symbol",
        source: dotSourceId,
        layout: {
          visibility: visible ? "visible" : "none",
          "icon-image": [
            "coalesce",
            ["image", ["concat", "pin-satellite-", ["get", "category"]]],
            ["image", "pin-satellite-default"]
          ],
          "icon-size": 0.8,
          "icon-allow-overlap": true
        },
        paint: { "icon-opacity": opacity }
      });
      map.addLayer({
        id: labelId,
        type: "symbol",
        source: dotSourceId,
        minzoom: 3,
        layout: {
          visibility: visible ? "visible" : "none",
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-max-width": 10,
          "text-font": ["Noto Sans Regular"]
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.4,
          "text-opacity": opacity
        }
      });
      registerInteractivePins(map, layerId, [dotId, labelId]);
    }
  }

  /** Redraw the ground tracks. Called on load, on a filter change and on the slow refresh — not
   *  on the one-second tick. */
  function renderTracks() {
    if (disposed || !map.getSource(trackSourceId)) return;
    const now = new Date();
    const from = new Date(now.getTime() - (TRACK_MINUTES / 4) * 60_000);
    const to = new Date(now.getTime() + TRACK_MINUTES * 60_000);
    const features: GeoFeature[] = [];
    for (const { element, satrec } of chosenSatrecs()) {
      features.push(
        ...groundTracks(satrec, from, to, {
          id: element.id,
          name: element.name,
          layerId,
          color: colorFor(element.category)
        })
      );
    }
    (map.getSource(trackSourceId) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features
    });
    firstTrackAt = Date.now();
  }

  /** Move the dots to the current instant. This is the cheap, frequent update. */
  function renderDots() {
    if (disposed || !map.getSource(dotSourceId)) return;
    const now = new Date();
    const features: GeoFeature[] = [];
    for (const { element, satrec } of chosenSatrecs()) {
      const current = positionAt(satrec, now);
      if (!current) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [current.lng, current.lat] },
        properties: {
          id: element.id,
          name: element.name,
          category: element.category,
          kind: "satellite",
          color: colorFor(element.category),
          layerId,
          altitudeKm: Math.round(current.altitudeKm),
          epoch: element.epoch
        }
      });
    }
    (map.getSource(dotSourceId) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features
    });
    emit("satellites-updated", { count: features.length, at: now.toISOString() });
  }

  function startTimers() {
    stopTimers();
    tickTimer = setInterval(renderDots, TICK_MS);
    trackTimer = setInterval(() => {
      // Only redraw the tracks once they have gone stale; the ticks in between are dots only.
      if (Date.now() - firstTrackAt >= TRACK_REFRESH_MS) renderTracks();
    }, TRACK_REFRESH_MS);
  }

  async function loadCatalog(filters: FilterValues, signal?: AbortSignal) {
    const requested = Array.isArray(filters.categories)
      ? filters.categories.filter((value): value is string => typeof value === "string")
      : [];
    const key = requested.slice().sort().join(",");
    if (key === currentFilterKey && satrecs.length) return;
    currentFilterKey = key;
    categories = requested;
    const query = requested.length ? `?categories=${encodeURIComponent(requested.join(","))}` : "";
    try {
      const response = await fetch(`${apiBaseUrl}/satellites/elements${query}`, { signal });
      if (!response.ok) throw new Error(`satellites ${response.status}`);
      const data = (await response.json()) as SatelliteCatalogResponse;
      if (signal?.aborted) return;
      elements = Array.isArray(data.elements) ? data.elements : [];
      buildSatrecs();
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) return;
      elements = [];
      satrecs = [];
    }
  }

  return {
    async update(
      _bbox: Bbox,
      filters: FilterValues,
      signal?: AbortSignal
    ): Promise<FeatureCollection | null> {
      ensureLayers();
      const keyBefore = currentFilterKey;
      await loadSatelliteMath();
      if (signal?.aborted || disposed) return null;
      await loadCatalog(filters, signal);
      if (signal?.aborted) return null;
      // The elements and the drawn tracks do not depend on the viewport, so a pan must not
      // rebuild them: only the first call and a category change need a full render. The dot
      // position comes from the layer's own one-second clock, not from `update`.
      if (!initialized || currentFilterKey !== keyBefore) {
        initialized = true;
        renderTracks();
        renderDots();
        startTimers();
      }
      // The map is drawn from the local clock, so there is no server feature list to return.
      return null;
    },
    setVisible(next: boolean) {
      visible = next;
      for (const id of [trackId, dotId, labelId]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", next ? "visible" : "none");
      }
      if (!next) stopTimers();
      else if (satrecs.length && visible) startTimers();
    },
    setOpacity(next: number) {
      opacity = next;
      if (map.getLayer(trackId)) map.setPaintProperty(trackId, "line-opacity", 0.5 * next);
      if (map.getLayer(dotId)) {
        map.setPaintProperty(dotId, "icon-opacity", next);
      }
      if (map.getLayer(labelId)) map.setPaintProperty(labelId, "text-opacity", next);
    },
    detach() {
      disposed = true;
      removeAll();
    }
  };
}
