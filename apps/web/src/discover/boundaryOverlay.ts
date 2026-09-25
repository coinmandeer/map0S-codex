import { fitArea } from "../map/fitArea";
import { contextClickSuppressed } from "../map/contextGesture";
import maplibregl from "maplibre-gl";
import type { AreaSelection } from "@mapos/layer-sdk";
import type { MapStore } from "../store/mapStore";
import { API_BASE, apiGet } from "../lib/api";
import { boundaryLevel, showAreaBoundaries, type BoundaryLevel } from "./boundaryLevel";
import { cachedTileTemplate } from "../map/tileCache";

/** Two bounded tile slots: keep the complete old view until its replacement is loaded. */
export function attachBoundaryOverlay(map: maplibregl.Map, store: MapStore): () => void {
  type Slot = {
    source: string;
    fill: string;
    line: string;
    halo: string;
    key: string;
    revision: string;
    paintKey?: string;
  };
  let current: Slot | null = null,
    pending: Slot | null = null,
    retiring: Slot | null = null,
    serial = 0;
  let template = "",
    revision = "",
    level: BoundaryLevel | undefined,
    disposed = false;
  // Draw only tiled boundaries: a second full-resolution parent outline would disagree
  // with the simplification of its child tiles. Leaf selection clears outlines entirely.
  let fittingSelection = false;
  let navigationArea: AreaSelection | null = store.areaSelection;
  let observedSelectionId = store.areaSelection?.id ?? null;
  // Camera navigation is separate from data filtering: step back to the parent when
  // leaving the framed area, rather than keeping a leaf filter locked forever.
  const navigation: Array<{
    area: AreaSelection;
    parent: AreaSelection | null;
    exitZoom: number;
    siblings: BoundaryLevel;
  }> = [];
  let framingId: string | null = null;
  let hoverId: string | number | undefined;
  const controller = new AbortController();
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
  const label = document.createElement("div");
  label.style.fontSize = "13px";
  label.style.fontWeight = "600";
  const selected = () => (store.mode === "game" ? null : store.areaSelection);
  const theming = () =>
    Object.entries(store.activeLayers).some(([id, s]) => id.startsWith("theme-") && s.visible);
  function remove(slot: Slot | null) {
    if (!slot) return;
    for (const id of [slot.line, slot.halo, slot.fill]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(slot.source)) map.removeSource(slot.source);
  }
  function clearHover() {
    if (hoverId !== undefined && current && map.getSource(current.source))
      map.setFeatureState(
        { source: current.source, sourceLayer: "boundaries", id: hoverId },
        { hover: false }
      );
    hoverId = undefined;
    popup.remove();
  }
  function paint(slot: Slot) {
    if (!map.getLayer(slot.line)) return;
    const paintKey = `${store.theme}:${theming()}:${selected()?.id ?? ""}`;
    if (slot.paintKey === paintKey) return;
    slot.paintKey = paintKey;
    const accent = store.theme === "dark" ? "#93c5fd" : "#2563eb";
    const active = [
      "any",
      ["boolean", ["feature-state", "hover"], false],
      ["==", ["get", "id"], selected()?.id ?? ""]
    ];
    map.setPaintProperty(slot.line, "line-color", accent);
    map.setPaintProperty(slot.line, "line-width", ["case", active, 2.5, 1.25]);
    map.setPaintProperty(slot.line, "line-opacity", 0.9);
    map.setPaintProperty(slot.halo, "line-color", store.theme === "dark" ? "#111827" : "#ffffff");
    map.setPaintProperty(slot.fill, "fill-color", accent);
    map.setPaintProperty(slot.fill, "fill-opacity", theming() ? 0 : ["case", active, 0.12, 0.025]);
  }
  function sync() {
    if (disposed || !map.isStyleLoaded()) return;
    for (const id of ["discover-fill", "discover-line"])
      if (map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none")
        map.setLayoutProperty(id, "visibility", "none");

    if (
      store.experienceId === "global" ||
      !showAreaBoundaries(store.boundariesEnabled, map.getZoom(), selected()?.level) ||
      store.mode === "game" ||
      (store.mode !== "discover" && !selected())
    ) {
      clearHover();
      remove(pending);
      remove(current);
      remove(retiring);
      retiring = null;
      pending = current = null;
      return;
    }
    if (!template) return;
    if (current && !map.getSource(current.source)) current = null;
    if (pending && !map.getSource(pending.source)) pending = null;
    level =
      store.boundaryLevel === "auto" ? boundaryLevel(map.getZoom(), level) : store.boundaryLevel;
    const activeRevision = selected()?.revision ?? revision;
    const selectionId = selected()?.id ?? null;
    if (selectionId !== observedSelectionId) {
      navigationArea = selected();
      observedSelectionId = selectionId;
      if (!selectionId) navigation.length = 0;
    }
    const area = navigationArea;
    if (area) {
      const levels: BoundaryLevel[] = ["country", "adm1", "adm2", "lau"];
      if (area.level === "lau") {
        clearHover();
        remove(current);
        remove(pending);
        remove(retiring);
        current = pending = retiring = null;
        return;
      }
      level = levels[Math.max(levels.indexOf(level), levels.indexOf(area.level) + 1)]!;
    }
    const key = `${activeRevision}:${level}:${area?.id ?? ""}`;
    if (current) paint(current);
    if (pending?.key === key || current?.key === key) {
      if (pending && pending.key !== key) {
        remove(pending);
        pending = null;
      }
      return;
    }
    remove(retiring);
    retiring = null;
    remove(pending);
    const source = `discover-boundary-${++serial}`;
    pending = {
      source,
      fill: source + "-fill",
      line: source + "-line",
      halo: source + "-halo",
      key,
      revision: activeRevision
    };
    map.addSource(source, {
      type: "vector",
      promoteId: "id",
      maxzoom: { country: 3, adm1: 5, adm2: 7, lau: 9 }[level],
      attribution: `<a href="${API_BASE}/v2/discover/boundaries">Boundary sources &amp; licences</a>`,
      tiles: [
        cachedTileTemplate(
          `${API_BASE}/v2/discover/boundaries/${activeRevision}/${level}/{z}/{x}/{y}.mvt${area ? `?areaId=${encodeURIComponent(area.id)}` : ""}`
        )
      ]
    });
    const common = { source, "source-layer": "boundaries" };
    map.addLayer({
      id: pending.fill,
      type: "fill",
      ...common,
      paint: {
        "fill-opacity": 0,
        "fill-opacity-transition": {
          duration:
            store.preferences.flyAnimations &&
            !window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? 120
              : 0
        }
      }
    });
    map.addLayer({
      id: pending.halo,
      type: "line",
      ...common,
      paint: {
        "line-width": 3.5,
        "line-opacity": 0,
        "line-opacity-transition": {
          duration:
            store.preferences.flyAnimations &&
            !window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? 120
              : 0
        }
      }
    });
    map.addLayer({
      id: pending.line,
      type: "line",
      ...common,
      paint: {
        "line-opacity": 0,
        "line-opacity-transition": {
          duration:
            store.preferences.flyAnimations &&
            !window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? 120
              : 0
        }
      }
    });
  }
  function loaded() {
    if (!pending || !map.getSource(pending.source) || !map.isSourceLoaded(pending.source)) return;
    const next = pending;
    pending = null;
    clearHover();
    remove(retiring);
    retiring = current;
    current = next;
    // Different zoom levels have different simplification. Never crossfade two
    // outlines of the same area: retain the old slot until ready, then replace it.
    remove(retiring);
    retiring = null;
    map.setPaintProperty(current.halo, "line-opacity", 0.7);
    paint(current);
  }
  function feature(event: maplibregl.MapMouseEvent) {
    if (!current || !map.getLayer(current.fill)) return null;
    const hits = map.queryRenderedFeatures(event.point);
    if (hits.some((f) => f.layer.id.startsWith("pins-") || f.layer.id.startsWith("route-")))
      return null;
    return hits.find((f) => f.layer.id === current!.fill) ?? null;
  }
  function hover(event: maplibregl.MapMouseEvent) {
    const f = feature(event);
    if (!f || !current) {
      clearHover();
      return;
    }
    if (f.id !== hoverId) {
      clearHover();
      hoverId = f.id;
      if (hoverId !== undefined)
        map.setFeatureState(
          { source: current.source, sourceLayer: "boundaries", id: hoverId },
          { hover: true }
        );
      label.textContent = `${f.properties.name} · ${{ country: "Stát", adm1: "Region", adm2: "Správní oblast", lau: "Obec" }[f.properties.level as BoundaryLevel] ?? "Oblast"} · ${f.properties.country}`;
      popup.setDOMContent(label);
    }
    if (theming()) popup.remove();
    else popup.setLngLat(event.lngLat).addTo(map);
  }
  function click(event: maplibregl.MapMouseEvent) {
    if (contextClickSuppressed(map)) return;
    const f = feature(event);
    if (!f || !current) return;
    const p = f.properties;
    const parent = navigationArea;
    const bbox = [p.west, p.south, p.east, p.north].map(Number);
    if (!bbox.every(Number.isFinite) || !String(p.id).startsWith("[")) return;
    fittingSelection = true;
    framingId = String(p.id);
    const selection = {
      id: String(p.id),
      revision: current.revision,
      name: String(p.name),
      level: p.level,
      source: String(p.source),
      country: String(p.country),
      code: String(p.code),
      bbox
    } as AreaSelection;
    navigation.push({ area: selection, parent, exitZoom: -Infinity, siblings: p.level });
    navigationArea = selection;
    observedSelectionId = selection.id;
    store.setAreaSelection(selection);
    const levels: BoundaryLevel[] = ["country", "adm1", "adm2", "lau"];
    const next = levels[Math.min(levels.indexOf(p.level) + 1, 3)]!;
    store.setBoundaryLevel(next);
    fittingSelection = true;
    fitArea(map, bbox as [number, number, number, number], {
      maxZoom: p.level === "lau" ? 17 : 13.5,
      animate: store.preferences.flyAnimations
    });
  }
  map.on("mousemove", hover);
  map.on("click", click);
  map.on("style.load", sync);
  let lastZoom = map.getZoom();
  const zoomed = () => {
    const zoom = map.getZoom();
    const top = navigation.at(-1);
    if (fittingSelection && top && top.area.id === framingId) {
      top.exitZoom = zoom - 0.4;
      framingId = null;
    } else if (zoom < lastZoom - 0.05) {
      let restored: BoundaryLevel | null = null;
      while (
        navigation.length &&
        navigationArea?.id === navigation.at(-1)!.area.id &&
        zoom < navigation.at(-1)!.exitZoom
      ) {
        const entry = navigation.pop()!;
        navigationArea = entry.parent;
        restored = entry.siblings;
      }
      // Restored siblings stay at their level until the next deliberate zoom gesture.
      store.setBoundaryLevel(restored ?? "auto");
      // A persisted selection has no in-memory camera history. Zooming out must still escape it.
      if (!restored && !navigation.length) navigationArea = null;
    }
    fittingSelection = false;
    lastZoom = zoom;
    sync();
  };
  map.on("zoomend", zoomed);
  map.on("sourcedata", loaded);
  map.on("idle", loaded);
  const off = store.subscribe(sync);
  let fetching = false;
  async function refresh() {
    if (store.experienceId === "global") return;
    if (fetching || disposed) return;
    fetching = true;
    try {
      const result = await apiGet<{ ready: boolean; revision: string; tileTemplate: string }>(
        "/v2/discover/boundaries",
        { signal: controller.signal }
      );
      if (!disposed && result.ready && /^[a-f0-9]{64}$/.test(result.revision)) {
        revision = result.revision;
        template = result.tileTemplate;
        try {
          localStorage.setItem(
            "mapos-boundary-manifest-v1",
            JSON.stringify({ revision, savedAt: Date.now() })
          );
        } catch {
          /* Optional cache. */
        }
        sync();
      }
    } catch {
      /* Preserve last complete edition. */
    } finally {
      fetching = false;
    }
  }
  try {
    const saved = JSON.parse(localStorage.getItem("mapos-boundary-manifest-v1") ?? "null");
    if (saved && /^[a-f0-9]{64}$/.test(saved.revision) && Date.now() - saved.savedAt < 86400000) {
      revision = saved.revision;
      template = "cached";
      sync();
    }
  } catch {
    /* Storage may be disabled. */
  }
  void refresh();
  const timer = setInterval(() => {
    if (store.mode === "discover" && !document.hidden) void refresh();
  }, 60000);
  return () => {
    disposed = true;
    remove(retiring);
    clearInterval(timer);
    controller.abort();
    off();
    clearHover();
    map.off("mousemove", hover);
    map.off("click", click);
    map.off("style.load", sync);
    map.off("zoomend", zoomed);
    map.off("sourcedata", loaded);
    map.off("idle", loaded);
    remove(pending);
    remove(current);
    popup.remove();
  };
}
