import type maplibregl from "maplibre-gl";
import type {
  Bbox,
  FeatureCollection,
  FilterValues,
  GeoFeature,
  LayerHandle
} from "@mapos/layer-sdk";
import { registerInteractivePins, unregisterInteractivePins } from "../../map/interactivePins";
import { MATERIAL_ICON_PATHS } from "../../map/materialIcons";
import { layerActivity } from "../../tasks/layerActivity";
import { registerLayer } from "../registry";

/**
 * Live air and sea traffic.
 *
 * Both layers work the same way and differ only in cadence: the server answers "what is in this
 * viewport", the client keeps the last measured fix per object and *interpolates* between fixes
 * using the reported speed and heading. The distinction matters — an interpolated position is a
 * drawing convenience, not a measurement, so an object whose fix goes stale stops moving, dims
 * and reports the age of its last position in the detail.
 *
 * Provider keys never reach the browser: the API owns the upstream connection and hands out
 * only the current viewport.
 */

export type LiveTrafficKind = "aircraft" | "vessels";

interface LiveConfig {
  minZoom: number;
  pollMs: number;
  renderMs: number;
  /** How long past the last fix a dead-reckoned position may still be drawn. */
  extrapolateS: number;
  /** After this the object is drawn as unreliable. */
  staleS: number;
  /** After this the object is dropped until the next report arrives. */
  dropS: number;
  color: string;
  labelFromZoom: number;
  /** Kinds whose heading is a direction of travel rather than an orientation; the icon rotates. */
  rotates: boolean;
}

const CONFIG: Record<LiveTrafficKind, LiveConfig> = {
  aircraft: {
    minZoom: 4,
    pollMs: 10_000,
    renderMs: 250,
    extrapolateS: 45,
    staleS: 90,
    dropS: 5 * 60,
    color: "#0EA5E9",
    labelFromZoom: 8,
    rotates: true
  },
  vessels: {
    minZoom: 5,
    pollMs: 15_000,
    renderMs: 750,
    extrapolateS: 90,
    staleS: 15 * 60,
    dropS: 45 * 60,
    color: "#0F766E",
    labelFromZoom: 9,
    rotates: true
  }
};

const KNOTS_TO_MPS = 0.514444;

interface LiveFix {
  feature: GeoFeature;
  /** The measured position, never overwritten by the interpolated one. */
  lng: number;
  lat: number;
  /** Client receipt time; provider-side age is carried separately so the two add up. */
  at: number;
  serverAgeS: number;
  speedMps: number;
  heading: number | null;
  course: number | null;
}

/** Moves a point along a bearing; the haversine destination formula, accurate enough at the
 *  kilometre scale a stale fix is allowed to drift. */
export function advance(
  lng: number,
  lat: number,
  headingDeg: number,
  distanceM: number
): { lng: number; lat: number } {
  if (!Number.isFinite(headingDeg) || !Number.isFinite(distanceM) || distanceM <= 0)
    return { lng, lat };
  const rad = Math.PI / 180;
  const delta = distanceM / 6371000;
  const theta = headingDeg * rad;
  const phi1 = lat * rad;
  const lambda1 = lng * rad;
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
    );
  return { lng: ((lambda2 / rad + 540) % 360) - 180, lat: phi2 / rad };
}

/** Split wrapped map bounds into API-compatible boxes instead of clipping the Pacific away. */
export function liveViewports(west: number, south: number, east: number, north: number): Bbox[] {
  south = Math.max(-85, south);
  north = Math.min(85, north);
  if (east - west >= 360) return [[-180, south, 180, north]];
  const wrap = (value: number) => ((((value + 180) % 360) + 360) % 360) - 180;
  const w = wrap(west),
    e = wrap(east);
  return w < e
    ? [[w, south, e, north]]
    : ([
        [w, south, 180, north],
        [-180, south, e, north]
      ].filter((b) => b[0]! < b[2]!) as Bbox[]);
}

function registerVehicleIcon(map: maplibregl.Map, kind: LiveTrafficKind, color: string) {
  const imageId = `live-${kind}`;
  if (map.hasImage(imageId)) return;
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  // Only the silhouette of the vehicle is drawn — no badge or circle. Material Symbols paths are
  // 24×24 and point north, which is also MapLibre's icon-rotate 0, so the shape reads as the
  // aircraft/ship itself and turns with its heading. A thin white halo keeps it legible over both
  // light and dark basemaps without turning the marker back into a dot.
  const path = MATERIAL_ICON_PATHS[kind === "aircraft" ? "flight" : "directions_boat"];
  if (!path) return;
  const shape = new Path2D(path);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(kind === "aircraft" ? 1.55 : 1.35, kind === "aircraft" ? 1.55 : 1.35);
  ctx.translate(-12, -12);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.stroke(shape);
  ctx.fillStyle = color;
  ctx.fill(shape);
  ctx.restore();
  map.addImage(imageId, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
}

export function createLiveTrafficLayer(
  map: maplibregl.Map,
  apiBaseUrl: string,
  layerId: string,
  kind: LiveTrafficKind
): LayerHandle {
  const cfg = CONFIG[kind];
  const sourceId = `source-live-${layerId}`;
  const symbolId = `live-${layerId}-icon`;
  const labelId = `live-${layerId}-label`;
  const fixes = new Map<string, LiveFix>();
  let visible = true;
  let disposed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let renderTimer: ReturnType<typeof setInterval> | null = null;
  let controller: AbortController | null = null;
  let lastStatus: "ready" | "partial" | "empty" | "error" | "zoom" = "empty";

  function ensureLayers() {
    registerInteractivePins(map, layerId, [symbolId, labelId]);
    if (map.getSource(sourceId)) return;
    registerVehicleIcon(map, kind, cfg.color);
    map.addSource(sourceId, {
      type: "geojson",
      promoteId: "id",
      data: { type: "FeatureCollection", features: [] }
    });
    map.addLayer({
      id: symbolId,
      type: "symbol",
      source: sourceId,
      layout: {
        visibility: visible ? "visible" : "none",
        "icon-image": `live-${kind}`,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.7, 8, 1, 14, 1.35],
        ...(cfg.rotates
          ? {
              "icon-rotate": ["coalesce", ["get", "heading"], 0],
              "icon-rotation-alignment": "map" as const
            }
          : {}),
        "icon-allow-overlap": true,
        "icon-ignore-placement": true
      },
      paint: {
        // A fix that has gone stale is still on the map, but it is no longer a live position.
        "icon-opacity": ["case", ["get", "stale"], 0.35, 0.95]
      }
    });
    map.addLayer({
      id: labelId,
      type: "symbol",
      source: sourceId,
      minzoom: cfg.labelFromZoom,
      layout: {
        visibility: visible ? "visible" : "none",
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
        "text-max-width": 11,
        "text-font": ["Noto Sans Regular"],
        "text-allow-overlap": false
      },
      paint: {
        "text-color": "#111827",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.4,
        "text-opacity": ["case", ["get", "stale"], 0.5, 0.95]
      }
    });
    render();
  }

  function render() {
    if (disposed || !visible || document.visibilityState !== "visible" || !map.getSource(sourceId))
      return;
    const now = Date.now();
    const features: GeoFeature[] = [];
    for (const [id, fix] of fixes) {
      const ageMs = Math.max(0, now - fix.at) + fix.serverAgeS * 1000;
      if (ageMs > cfg.dropS * 1000) {
        fixes.delete(id);
        continue;
      }
      const stale = ageMs > cfg.staleS * 1000;
      // Dead reckoning only while the fix is plausible; past the window the object holds its
      // last measured position and says how old it is.
      const extrapolationS = stale ? 0 : Math.min(ageMs / 1000, cfg.extrapolateS);
      const distanceM = Math.min(5000, fix.speedMps * extrapolationS);
      const shown =
        extrapolationS > 0 && fix.course !== null
          ? advance(fix.lng, fix.lat, fix.course, distanceM)
          : { lng: fix.lng, lat: fix.lat };
      features.push({
        ...fix.feature,
        geometry: { type: "Point", coordinates: [shown.lng, shown.lat] },
        properties: {
          ...fix.feature.properties,
          heading: fix.heading ?? undefined,
          stale,
          fixAgeSeconds: Math.round(ageMs / 1000),
          observedAt: new Date(fix.at - fix.serverAgeS * 1000).toISOString(),
          receivedAt: new Date(fix.at).toISOString(),
          positionMode: distanceM > 0 && fix.course !== null ? "estimated" : "observed"
        }
      });
    }
    (map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features
    });
  }

  async function poll() {
    if (disposed || !visible || document.visibilityState !== "visible") return;
    if (map.getZoom() < cfg.minZoom) {
      if (fixes.size) {
        fixes.clear();
        render();
      }
      if (lastStatus !== "zoom") {
        lastStatus = "zoom";
        layerActivity.state(layerId, "zoom");
      }
      return;
    }
    controller?.abort();
    const request = new AbortController();
    controller = request;
    try {
      const bounds = map.getBounds();
      const boxes = liveViewports(
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth()
      );
      const replies = await Promise.all(
        boxes.map(async (box) => {
          const response = await fetch(
            `${apiBaseUrl}/live/${kind}?bbox=${box.map((value) => value.toFixed(3)).join(",")}`,
            { signal: request.signal }
          );
          if (!response.ok) throw new Error(`live ${kind} ${response.status}`);
          return (await response.json()) as {
            features?: GeoFeature[];
            status?: string;
            notice?: string;
          };
        })
      );
      const limit = kind === "aircraft" ? 400 : 600;
      const all = [
        ...new Map(
          replies
            .flatMap((reply) => reply.features ?? [])
            .map((feature) => [feature.properties.id, feature])
        ).values()
      ];
      const data = {
        features: all.slice(0, limit),
        status:
          replies.some((r) => r.status === "partial") || all.length > limit
            ? "partial"
            : "complete",
        notice:
          [...new Set(replies.map((r) => r.notice).filter(Boolean))].join(" · ") ||
          (all.length > limit ? `Zobrazeno nejvýše ${limit} objektů. Přibliž mapu.` : undefined)
      };
      if (disposed || request.signal.aborted) return;
      const seen = new Set<string>();
      for (const feature of data.features ?? []) {
        const id = String(feature.properties.id ?? "");
        const [lng, lat] = (feature.geometry.coordinates ?? []) as [number, number];
        if (!id || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        seen.add(id);
        const speedKt = Number(feature.properties.speedKt ?? 0);
        const direction = (value: unknown) => {
          if (value === null || value === undefined) return null;
          const n = Number(value);
          return Number.isFinite(n) && n >= 0 && n < 360 ? n : null;
        };
        const course =
          direction(feature.properties.courseDeg) ?? direction(feature.properties.headingDeg);
        const heading = direction(feature.properties.headingDeg) ?? course;
        const observedAt =
          typeof feature.properties.observedAt === "string"
            ? Date.parse(feature.properties.observedAt)
            : NaN;
        fixes.set(id, {
          feature,
          lng,
          lat,
          at: Date.now(),
          serverAgeS: Number.isFinite(observedAt)
            ? Math.max(0, (Date.now() - observedAt) / 1000)
            : Math.max(
                0,
                Number(
                  feature.properties.seenPosSeconds ?? feature.properties.fixAgeSeconds ?? 0
                ) || 0
              ),
          speedMps:
            Number.isFinite(speedKt) && (kind !== "vessels" || speedKt < 102.3)
              ? Math.max(0, speedKt) * KNOTS_TO_MPS
              : 0,
          heading,
          course
        });
      }
      // Objects the provider no longer returns left the viewport or stopped reporting.
      for (const id of [...fixes.keys()]) if (!seen.has(id)) fixes.delete(id);
      lastStatus =
        data.status === "partial"
          ? "partial"
          : (data.features?.length ?? 0) === 0
            ? "empty"
            : "ready";
      layerActivity.state(layerId, lastStatus, data.notice ?? `${data.features?.length ?? 0}`);
      render();
    } catch (error) {
      if (
        disposed ||
        request.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      )
        return;
      if (lastStatus !== "error") {
        lastStatus = "error";
        layerActivity.state(layerId, "error", "Zdroj se nepodařilo načíst");
      }
    }
  }

  function startTimers() {
    stopTimers();
    if (!visible || document.visibilityState !== "visible") return;
    pollTimer = setInterval(() => void poll(), cfg.pollMs);
    renderTimer = setInterval(render, cfg.renderMs);
  }

  function stopTimers() {
    if (pollTimer) clearInterval(pollTimer);
    if (renderTimer) clearInterval(renderTimer);
    pollTimer = null;
    renderTimer = null;
  }

  const visibilityChanged = () => {
    stopTimers();
    if (visible && !disposed && document.visibilityState === "visible") {
      startTimers();
      void poll();
    } else controller?.abort();
  };
  document.addEventListener("visibilitychange", visibilityChanged);

  return {
    async update(
      _nextBbox: Bbox,
      _filters: FilterValues,
      signal?: AbortSignal
    ): Promise<FeatureCollection | null> {
      ensureLayers();
      if (signal?.aborted) return null;
      // The viewport changed: fetch immediately instead of waiting for the next tick, so a pan
      // does not show an empty sky for ten seconds.
      void poll();
      if (!pollTimer) startTimers();
      return null;
    },
    setVisible(next: boolean) {
      visible = next;
      ensureLayers();
      for (const id of [symbolId, labelId]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", next ? "visible" : "none");
      }
      if (next) {
        startTimers();
        void poll();
      } else {
        stopTimers();
      }
    },
    setOpacity(next: number) {
      if (map.getLayer(symbolId))
        map.setPaintProperty(symbolId, "icon-opacity", [
          "case",
          ["get", "stale"],
          0.35 * next,
          0.95 * next
        ]);
      if (map.getLayer(labelId))
        map.setPaintProperty(labelId, "text-opacity", [
          "case",
          ["get", "stale"],
          0.5 * next,
          0.95 * next
        ]);
    },
    detach() {
      disposed = true;
      document.removeEventListener("visibilitychange", visibilityChanged);
      stopTimers();
      controller?.abort();
      unregisterInteractivePins(map, [symbolId, labelId]);
      for (const id of [labelId, symbolId]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      fixes.clear();
    }
  };
}

/** Live aircraft: ADSB.lol (ODbL 1.0). Keyless, coverage follows receiver density. */
registerLayer({
  kind: "custom-gl",
  geometryKinds: ["Point"],
  renderer: { type: "symbols" },
  areaFilter: "context",
  manifest: {
    id: "live-aircraft",
    name: "Letadla (živě)",
    icon: "✈️",
    color: CONFIG.aircraft.color,
    description:
      "Živé polohy letadel z ADSB.lol (ODbL 1.0). Poloha se mezi zprávami dopočítává ze rychlosti a kurzu; u starších zpráv se ikona ztlumí a detail uvede stáří. Bez záruky úplnosti — chybí, co žádný přijímač neslyšel.",
    category: "transport",
    performance: { maxEntities: 400, refreshIntervalMs: CONFIG.aircraft.pollMs }
  },
  filters: [],
  detail: {
    fieldOrder: [
      "callsign",
      "registration",
      "aircraftType",
      "altitudeFt",
      "speedKt",
      "headingDeg",
      "verticalRateFpm",
      "onGround",
      "fixAgeSeconds",
      "squawk",
      "emergency"
    ]
  },
  minQueryZoom: CONFIG.aircraft.minZoom,
  create: (ctx) => createLiveTrafficLayer(ctx.map, ctx.apiBaseUrl, ctx.layerId, "aircraft"),
  attribution: [
    {
      label: "ADSB.lol",
      url: "https://adsb.lol",
      license: "ODbL 1.0"
    }
  ]
});

/** Live vessels: AISstream worldwide when the deployment has a key, Digitraffic (CC BY 4.0)
 *  for Finnish waters otherwise. The API picks the source and the feature carries its name. */
registerLayer({
  kind: "custom-gl",
  geometryKinds: ["Point"],
  renderer: { type: "symbols" },
  areaFilter: "context",
  manifest: {
    id: "live-vessels",
    name: "Lodě (živě)",
    icon: "🚢",
    color: CONFIG.vessels.color,
    description:
      "Živé polohy lodí (AIS). Ve světě přes AISstream, bez klíče jen finské vody přes Digitraffic. Rychlost a kurz dopočítávají polohu mezi zprávami, u vyprchavších zpráv se ikona ztlumí. Pokrytí závisí na pobřežních přijímačích.",
    category: "transport",
    performance: { maxEntities: 600, refreshIntervalMs: CONFIG.vessels.pollMs }
  },
  filters: [],
  detail: {
    fieldOrder: [
      "mmsi",
      "imo",
      "shipType",
      "speedKt",
      "courseDeg",
      "headingDeg",
      "navStatus",
      "destination",
      "callSign",
      "fixAgeSeconds"
    ]
  },
  minQueryZoom: CONFIG.vessels.minZoom,
  create: (ctx) => createLiveTrafficLayer(ctx.map, ctx.apiBaseUrl, ctx.layerId, "vessels"),
  attribution: [
    {
      label: "AISstream",
      url: "https://aisstream.io",
      license: "free stream; wider use to be confirmed with the operator"
    },
    {
      label: "Digitraffic (Fintraffic)",
      url: "https://www.digitraffic.fi/en/marine-traffic/",
      license: "CC BY 4.0"
    }
  ]
});
