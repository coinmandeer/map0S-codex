import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { MapLibreDataLayerLifecycle } from "@mapos/map-runtime";
import { MAP_STYLE_RASTER_FALLBACK, MAP_STYLE_RASTER_FALLBACK_DARK } from "./mapStyle";
import { usesMapyTiles } from "@mapos/layer-sdk";
import { MapyLogoControl } from "./styleManager";
import { overlayForBasemap, resolveBasemap, styleForBasemap } from "./basemapStyle";
import { apply3dBuildings } from "./buildings3d";
import { chromeMapPadding, readChromeInsets } from "./chromePadding";
import { getMapStore, getMapBbox, type LayerMode } from "../store/mapStore";
import { LayerEngine } from "../engine/LayerEngine";
import { activeAttribution } from "../layers/attribution";
import { API_BASE } from "../lib/api";
import { emit, on, onAny } from "../lib/events";
import { geolocation } from "../lib/geolocation";
import { chooseMapClickTarget } from "./mapClickPriority";
import { MAP_RUNTIME_V2_ENABLED } from "../lib/featureFlags";
import { safeBrowserErrorFields } from "../lib/safeError";
import { browserProviderHealth } from "../tasks/BrowserProviderHealth";
import { directBrowserBasemapProviderId, isBasemapRuntimeError } from "./browserBasemapProvider";

// The previous 18.2 zoom showed roughly one block and made a three-metre avatar feel enormous.
// These views frame the kilometre orb sector: follow stays close enough to read the character,
// while top view shows the board as a board.
const GAME_FOLLOW_PITCH = 52;
const GAME_FOLLOW_ZOOM = 17.2;
const GAME_TOP_ZOOM = 15.8;
const GAME_FOLLOW_UPDATE_MS = 100;

export function MapCore() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const engineRef = useRef<LayerEngine | null>(null);
  const geoWatchRef = useRef<(() => void) | null>(null);
  const store = getMapStore();

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    // Force non-zero size before MapLibre measures the container
    el.style.position = "fixed";
    el.style.inset = "0";
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.zIndex = "0";

    const initialBasemap = resolveBasemap(store.basemapId, store.theme);
    let activeBasemapProviderId = directBrowserBasemapProviderId(initialBasemap.id);
    let pendingBasemapHealth = activeBasemapProviderId
      ? { providerId: activeBasemapProviderId, startedAt: performance.now() }
      : null;

    const recordPendingBasemap = (outcome: "success" | "error" | "aborted") => {
      const pending = pendingBasemapHealth;
      if (!pending) return;
      browserProviderHealth.record({
        providerId: pending.providerId,
        outcome,
        durationMs: performance.now() - pending.startedAt
      });
      pendingBasemapHealth = null;
    };

    const beginBasemapHealth = (basemapId: string) => {
      recordPendingBasemap("aborted");
      activeBasemapProviderId = directBrowserBasemapProviderId(basemapId);
      pendingBasemapHealth = activeBasemapProviderId
        ? { providerId: activeBasemapProviderId, startedAt: performance.now() }
        : null;
    };

    const map = new maplibregl.Map({
      container: el,
      style: styleForBasemap(initialBasemap, {
        theme: store.theme,
        apiBase: API_BASE,
        labels: store.basemapLabels,
        capabilities: store.capabilities
      }),
      center: [store.view.lng, store.view.lat],
      zoom: store.view.zoom,
      attributionControl: false,
      // Base experience stays a flat 2D map (no user-driven tilt/rotate); pitch is only ever
      // raised programmatically when entering the 3D game mode (see onModeChanged below).
      maxPitch: 65,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 0
    });
    const dataLayerLifecycle = MAP_RUNTIME_V2_ENABLED ? new MapLibreDataLayerLifecycle(map) : null;
    let pendingGameFollow: { lng: number; lat: number } | null = null;
    let gameFollowTimer: ReturnType<typeof setTimeout> | null = null;
    let lastGameFollowAt = 0;
    let pendingViewportRefresh = false;

    const applyGameFollow = () => {
      gameFollowTimer = null;
      const target = pendingGameFollow;
      pendingGameFollow = null;
      if (!target || store.mode !== "game" || store.gameCameraMode !== "follow") return;
      const center = map.getCenter();
      if (Math.hypot(center.lng - target.lng, center.lat - target.lat) < 1e-8) return;
      lastGameFollowAt = performance.now();
      map.easeTo({
        center: [target.lng, target.lat],
        duration: 120,
        essential: true
      });
      emit("map-bearing", { bearing: map.getBearing() });
    };

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("error", (event) => {
      console.warn("MapLibre error", safeBrowserErrorFields(event.error ?? event));
      const sourceId = (event as maplibregl.ErrorEvent & { sourceId?: unknown }).sourceId;
      const isBasemapError = isBasemapRuntimeError({
        sourceId,
        styleLoaded: map.isStyleLoaded() === true,
        hasPendingBasemap: pendingBasemapHealth !== null
      });
      if (isBasemapError && activeBasemapProviderId) {
        if (pendingBasemapHealth?.providerId === activeBasemapProviderId) {
          recordPendingBasemap("error");
        } else {
          browserProviderHealth.record({
            providerId: activeBasemapProviderId,
            outcome: "error",
            durationMs: 0
          });
        }
      }
      if (!isBasemapError) return;
      const fallbackStyle =
        store.theme === "dark" ? MAP_STYLE_RASTER_FALLBACK_DARK : MAP_STYLE_RASTER_FALLBACK;
      // Once the emergency style owns the map, any error from its own provider must not recurse.
      // Checking the actual drawn style is more robust than a sticky boolean: a later explicit
      // basemap selection naturally becomes eligible for one fresh recovery attempt.
      if (map.getStyle().name === fallbackStyle.name) return;
      beginBasemapHealth(store.theme === "dark" ? "carto-dark" : "osm-carto");
      store.showToast(
        "Mapový podklad se nepodařilo načíst. Zobrazuji nouzovou mapu; tvoje vrstvy zůstaly zapnuté.",
        { durationMs: 8000 }
      );
      map.setStyle(fallbackStyle);
    });

    map.on("idle", () => {
      recordPendingBasemap("success");
      if (!pendingViewportRefresh) return;
      pendingViewportRefresh = false;
      engineRef.current?.refresh(getMapBbox(map), false);
    });

    const resize = () => {
      map.resize();
    };
    resize();
    requestAnimationFrame(resize);
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);

    const emitDiscoverViewport = () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      if (!Number.isFinite(center.lng) || !Number.isFinite(center.lat) || zoom < 1) return;
      emit("discover-viewport", { lng: center.lng, lat: center.lat, zoom, bbox: getMapBbox(map) });
    };

    map.on("moveend", () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      if (!Number.isFinite(center.lng) || !Number.isFinite(center.lat) || zoom < 1) return;
      // Camera state belongs to the shell, not to the basemap lifecycle. On a slow connection the
      // style may still be loading when a user pans under the fixed map-picker pin; dropping that
      // move strands the picker on stale coordinates. Only data refresh needs a ready style.
      store.setView({ lng: center.lng, lat: center.lat, zoom });
      emit("map-view-changed", { lng: center.lng, lat: center.lat, zoom });
      if (map.isStyleLoaded()) {
        pendingViewportRefresh = false;
        engineRef.current?.refresh(getMapBbox(map), false);
      } else {
        pendingViewportRefresh = true;
      }
      emitDiscoverViewport();
    });

    // Collected so teardown is one loop instead of a hand-maintained list of removeEventListener
    // calls that has to stay in step with the registrations above it.
    const offs: Array<() => void> = [];

    offs.push(
      on("fly-to", (detail) => {
        const camera = {
          center: [detail.lng, detail.lat] as [number, number],
          zoom: detail.zoom ?? 14
        };
        if (store.preferences.flyAnimations) map.flyTo({ ...camera, essential: true });
        else map.jumpTo(camera);
      })
    );

    const onSearchHere = () => {
      if (map.isStyleLoaded()) engineRef.current?.refresh(getMapBbox(map), true);
    };
    offs.push(on("search-here", onSearchHere));

    const onModeChanged = (detail: { mode: LayerMode }) => {
      const cameraMode = store.gameCameraMode;
      if (detail.mode === "game") {
        map.easeTo({
          pitch: cameraMode === "follow" ? GAME_FOLLOW_PITCH : 0,
          zoom: cameraMode === "follow" ? GAME_FOLLOW_ZOOM : GAME_TOP_ZOOM,
          duration: 600
        });
      } else {
        pendingGameFollow = null;
        if (gameFollowTimer) {
          clearTimeout(gameFollowTimer);
          gameFollowTimer = null;
        }
        map.easeTo({ pitch: 0, duration: 600 });
      }
    };
    offs.push(on("mode-changed", onModeChanged));

    offs.push(
      on("game-camera-changed", (detail) => {
        if (store.mode !== "game") return;
        map.easeTo({
          pitch: detail.mode === "follow" ? GAME_FOLLOW_PITCH : 0,
          zoom: detail.mode === "follow" ? GAME_FOLLOW_ZOOM : GAME_TOP_ZOOM,
          duration: 500
        });
      })
    );

    offs.push(
      on("geolocation", (detail) => {
        if (store.mode !== "game" || store.gameCameraMode !== "follow") return;
        pendingGameFollow = detail;
        const remaining = GAME_FOLLOW_UPDATE_MS - (performance.now() - lastGameFollowAt);
        if (remaining <= 0) applyGameFollow();
        else if (!gameFollowTimer) gameFollowTimer = setTimeout(applyGameFollow, remaining);
      })
    );

    const onCountryOrTag = () => {
      if (map.isStyleLoaded()) engineRef.current?.refresh(getMapBbox(map), true);
    };
    offs.push(onAny(["country-changed", "tag-changed"], onCountryOrTag));

    // The Mapy logo control is a licence condition, so its lifetime is bound to the tiles that
    // are actually drawn — including the case where only the label overlay is theirs.
    const mapyLogo = new MapyLogoControl();
    const syncMapyChrome = (shouldShow: boolean) => {
      if (shouldShow && !map.hasControl(mapyLogo)) map.addControl(mapyLogo, "bottom-left");
      if (!shouldShow && map.hasControl(mapyLogo)) map.removeControl(mapyLogo);
    };
    syncMapyChrome(
      usesMapyTiles(
        initialBasemap.id,
        overlayForBasemap(initialBasemap, {
          labels: store.basemapLabels,
          capabilities: store.capabilities
        })
      )
    );

    // Credits follow what is switched on: most of these licences ask to be named while the data
    // is on screen, not in general. The list is read from the plugins, so a layer added by a fork
    // is credited without this file knowing about it. MapLibre reads `customAttribution` once at
    // construction, hence the swap instead of a mutation.
    let attributionControl: maplibregl.AttributionControl | null = null;
    let creditedSources = "";
    const syncAttribution = () => {
      const custom = activeAttribution(store.activeLayers, store.poiSources).map((credit) =>
        credit.url
          ? `<a href="${credit.url}" target="_blank" rel="noreferrer">${credit.label}</a>`
          : credit.label
      );
      const key = custom.join("|");
      if (attributionControl && key === creditedSources) return;
      creditedSources = key;
      if (attributionControl) map.removeControl(attributionControl);
      attributionControl = new maplibregl.AttributionControl({
        compact: true,
        customAttribution: custom
      });
      map.addControl(attributionControl, "bottom-left");
      // A compact control opens itself on creation and only folds away on the first map
      // interaction. The control is recreated whenever the credits change, so without this every
      // layer toggle would pop the credit panel open across the bottom of a phone screen.
      requestAnimationFrame(() => {
        map
          .getContainer()
          .querySelector(".maplibregl-ctrl-attrib")
          ?.classList.remove("maplibregl-compact-show");
      });
    };
    syncAttribution();
    offs.push(store.subscribe(syncAttribution));

    const applyBasemap = () => {
      const basemap = resolveBasemap(store.basemapId, store.theme);
      beginBasemapHealth(basemap.id);
      syncMapyChrome(
        usesMapyTiles(
          basemap.id,
          overlayForBasemap(basemap, {
            labels: store.basemapLabels,
            capabilities: store.capabilities
          })
        )
      );
      map.setStyle(
        styleForBasemap(basemap, {
          theme: store.theme,
          apiBase: API_BASE,
          labels: store.basemapLabels,
          capabilities: store.capabilities
        })
      );
      // A background with no building outlines leaves nothing standing up, and a tilted camera over
      // a flat photo just distorts it. The setting itself is kept, so going back to a vector
      // background restores the view the user chose.
      if (!basemap.buildingSourceLayer && map.getPitch() > 0 && store.mode !== "game") {
        map.easeTo({ pitch: 0, duration: 500 });
      }
    };

    offs.push(on("theme-changed", applyBasemap));
    offs.push(on("basemap-changed", applyBasemap));
    offs.push(
      on("buildings-3d-changed", (detail) => {
        apply3dBuildings(map, detail.enabled);
        // Extrusions are invisible from straight above, and the user cannot tilt by hand (drag
        // rotation is off, so the map stays predictable). Switching them on therefore has to
        // provide the viewpoint that makes them mean anything — and close enough to see it,
        // since the layer only draws from z14. The game mode runs its own camera.
        if (store.mode === "game") return;
        map.easeTo({
          pitch: detail.enabled ? 55 : 0,
          zoom: detail.enabled ? Math.max(map.getZoom(), 15.5) : map.getZoom(),
          duration: 700
        });
      })
    );

    offs.push(
      on("discover-geojson", (detail) => {
        const src = map.getSource("discover-regions") as maplibregl.GeoJSONSource | undefined;
        src?.setData(detail.geojson ?? { type: "FeatureCollection", features: [] });
      })
    );

    offs.push(
      on("fit-bounds", ({ bbox }) => {
        if (!bbox) return;
        map.fitBounds(
          [
            [bbox[0], bbox[1]],
            [bbox[2], bbox[3]]
          ],
          { padding: 48, duration: 700, maxZoom: 11 }
        );
      })
    );

    map.on("click", (e) => {
      if (store.editMode && store.editLayerId) {
        emit("edit-tap", { lng: e.lngLat.lng, lat: e.lngLat.lat });
        return;
      }

      if (map.getLayer("route-preview-alternatives")) {
        const variantHit = map.queryRenderedFeatures(e.point, {
          layers: ["route-preview-alternatives"]
        })[0];
        const segmentId = variantHit?.properties?.segmentId;
        const alternativeId = variantHit?.properties?.alternativeId;
        if (typeof segmentId === "string" && typeof alternativeId === "string") {
          store.selectRouteSegment(segmentId);
          emit("plan-alternative-picked", { segmentId, alternativeId });
          return;
        }
      }

      if (map.getLayer("route-preview-line")) {
        const routeHit = map.queryRenderedFeatures(e.point, {
          layers: ["route-preview-line"]
        })[0];
        const segmentId = routeHit?.properties?.segmentId;
        if (typeof segmentId === "string") {
          store.selectRouteSegment(segmentId);
          return;
        }
      }

      const pinLayers =
        map
          .getStyle()
          .layers?.filter((l) => l.id.startsWith("pins-") && !l.id.includes("-cluster"))
          .map((l) => l.id) ?? [];

      const pinHits = pinLayers.length
        ? map.queryRenderedFeatures(e.point, { layers: pinLayers })
        : [];
      const weatherLayerId = "fill-weather-sectors";
      const weatherHit = map.getLayer(weatherLayerId)
        ? map.queryRenderedFeatures(e.point, { layers: [weatherLayerId] })[0]
        : undefined;
      const regionHits =
        store.mode === "discover" && map.getLayer("discover-fill")
          ? map.queryRenderedFeatures(e.point, { layers: ["discover-fill"] })
          : [];
      const target = chooseMapClickTarget(pinHits, regionHits);

      if (target?.kind === "pin") {
        const f = target.feature;
        const props = f.properties as Record<string, string>;
        const layerId = props.layerId ?? f.layer.id.replace("pins-", "").split("-")[0]!;
        engineRef.current?.handlePinClick(layerId, {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: (f.geometry as GeoJSON.Point).coordinates as [number, number]
          },
          properties: {
            ...props,
            id: props.id ?? String(f.id),
            name: props.name ?? "Pin",
            layerId
          }
        });
        return;
      }
      if (weatherHit?.properties) {
        const properties = weatherHit.properties as Record<string, unknown>;
        const value = Number(properties.value);
        if (Number.isFinite(value)) {
          emit("weather-cell-selected", {
            interaction: "tap",
            variable: String(properties.variable ?? "weather"),
            variableLabel: String(properties.variableLabel ?? "Počasí"),
            value,
            label: String(properties.label ?? `${value}`),
            unit: String(properties.unit ?? ""),
            validAt: String(properties.validAt ?? ""),
            lng: e.lngLat.lng,
            lat: e.lngLat.lat
          });
          return;
        }
      }
      if (target?.kind === "region" && target.feature.properties) {
        const properties = target.feature.properties as Record<string, unknown>;
        emit("discover-click", {
          ...properties,
          lng: e.lngLat.lng,
          lat: e.lngLat.lat
        });
        store.setSidebarOpen(true);
        const name = typeof properties.name === "string" ? properties.name : null;
        store.showToast(
          properties.kind === "candidate"
            ? name
              ? `Přepínám na oblast: ${name}`
              : "Přepínám na vybranou oblast"
            : name
              ? `Vybraná oblast: ${name}`
              : "Vybraná oblast je otevřená"
        );
      }
    });

    const initOverlays = () => {
      resize();
      if (!engineRef.current) {
        engineRef.current = new LayerEngine(map, API_BASE, store, undefined, dataLayerLifecycle);
      }
      engineRef.current.refresh(getMapBbox(map), true);
      // Extrusions live in the style, so they are gone after every background switch and have
      // to be re-added here rather than only when the toggle is flipped.
      apply3dBuildings(map, store.buildings3d);

      if (!map.getSource("route-preview")) {
        map.addSource("route-preview", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] }
        });
        map.addLayer({
          id: "route-preview-casing",
          type: "line",
          source: "route-preview",
          filter: ["==", ["get", "kind"], "route"],
          paint: {
            "line-color": "rgba(15, 23, 42, 0.78)",
            "line-width": 8,
            "line-opacity": 0.72
          },
          layout: { "line-cap": "round", "line-join": "round" }
        });
        // §16.6: the variants a segment was not routed with stay on the map, dimmed, so the
        // choice can be made by pointing at the line instead of reading the itinerary.
        map.addLayer({
          id: "route-preview-alternatives",
          type: "line",
          source: "route-preview",
          filter: ["==", ["get", "kind"], "alternative"],
          paint: {
            "line-color": "#2563eb",
            "line-width": 5,
            "line-opacity": 0.35,
            "line-dasharray": [2, 1.5]
          },
          layout: { "line-cap": "round", "line-join": "round" }
        });
        map.addLayer({
          id: "route-preview-line",
          type: "line",
          source: "route-preview",
          filter: ["==", ["get", "kind"], "route"],
          paint: {
            "line-color": ["case", ["boolean", ["get", "selected"], false], "#f97316", "#2563eb"],
            "line-width": ["case", ["boolean", ["get", "selected"], false], 7, 5],
            "line-opacity": 0.96
          },
          layout: { "line-cap": "round", "line-join": "round" }
        });
        map.addLayer({
          id: "route-preview-stops",
          type: "circle",
          source: "route-preview",
          filter: ["==", ["get", "kind"], "stop"],
          paint: {
            "circle-radius": 11,
            "circle-color": "#ffffff",
            "circle-stroke-color": "#1d4ed8",
            "circle-stroke-width": 3
          }
        });
        map.addLayer({
          id: "route-preview-stop-labels",
          type: "symbol",
          source: "route-preview",
          filter: ["==", ["get", "kind"], "stop"],
          layout: {
            "text-field": ["to-string", ["get", "order"]],
            "text-size": 11,
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-allow-overlap": true,
            "text-ignore-placement": true
          },
          paint: { "text-color": "#1d4ed8" }
        });
      }

      // Highlight for the pin whose detail is open (§4.10). Its own layer rather than a filter
      // on the data layers: the selection has to survive a layer refresh and a style switch.
      if (!map.getSource("selected-pin")) {
        map.addSource("selected-pin", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] }
        });
        map.addLayer({
          id: "selected-pin-pulse",
          type: "circle",
          source: "selected-pin",
          paint: {
            "circle-radius": 14,
            "circle-color": "transparent",
            "circle-stroke-color": "#1e4fd8",
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 0.9
          }
        });
      }

      if (!map.getSource("my-location")) {
        map.addSource("my-location", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] }
        });
        map.addLayer({
          id: "my-location-accuracy",
          type: "circle",
          source: "my-location",
          paint: {
            "circle-radius": ["get", "accuracyRadius"],
            "circle-color": "#3b82f6",
            "circle-opacity": 0.15
          }
        });
        map.addLayer({
          id: "my-location-dot",
          type: "circle",
          source: "my-location",
          paint: {
            "circle-radius": 8,
            "circle-color": "#3b82f6",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff"
          }
        });
      }

      if (!map.getSource("discover-regions")) {
        map.addSource("discover-regions", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] }
        });
        map.addLayer({
          id: "discover-fill",
          type: "fill",
          source: "discover-regions",
          paint: {
            "fill-color": ["case", ["==", ["get", "kind"], "selected"], "#B7791F", "#2563EB"],
            "fill-opacity": ["case", ["==", ["get", "kind"], "selected"], 0.14, 0.07]
          }
        });
        map.addLayer({
          id: "discover-line",
          type: "line",
          source: "discover-regions",
          paint: {
            "line-color": ["case", ["==", ["get", "kind"], "selected"], "#B7791F", "#2563EB"],
            "line-width": ["case", ["==", ["get", "kind"], "selected"], 2, 1.25],
            "line-opacity": ["case", ["==", ["get", "kind"], "selected"], 0.85, 0.62]
          }
        });
      }

      // Device GPS only feeds the blue "you are here" dot. The game's player position is a
      // separate signal (`geolocation`) owned by useSimulationController — broadcasting raw
      // fixes from here as well would fight WASD movement in simulation mode.
      if (geoWatchRef.current === null) {
        geoWatchRef.current = geolocation.watch((fix) => {
          const src = map.getSource("my-location") as maplibregl.GeoJSONSource | undefined;
          src?.setData({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [fix.lng, fix.lat] },
                properties: { accuracyRadius: Math.min(fix.accuracy, 200) }
              }
            ]
          });
        });
      }
    };

    map.on("load", () => {
      initOverlays();
      emitDiscoverViewport();
      if (store.mode === "game") {
        map.easeTo({
          pitch: store.gameCameraMode === "follow" ? GAME_FOLLOW_PITCH : 0,
          zoom: store.gameCameraMode === "follow" ? GAME_FOLLOW_ZOOM : GAME_TOP_ZOOM,
          duration: 0
        });
      }
    });
    map.on("style.load", initOverlays);

    mapRef.current = map;

    // End-to-end tests need to ask the map what it actually rendered — "is this layer attached?"
    // has no DOM equivalent on a canvas. Dev-only, so it never reaches a production bundle.
    if (import.meta.env.DEV) window.__maposMap = map;

    return () => {
      if (gameFollowTimer) clearTimeout(gameFollowTimer);
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
      for (const off of offs) off();
      geoWatchRef.current?.();
      geoWatchRef.current = null;
      engineRef.current?.destroy();
      engineRef.current = null;
      dataLayerLifecycle?.destroy();
      map.remove();
      mapRef.current = null;
      if (import.meta.env.DEV) delete window.__maposMap;
    };
  }, [store]);

  useEffect(() => {
    const handler = () => {
      if (!mapRef.current || !engineRef.current) return;
      engineRef.current.syncLayers(store.activeLayers);
      // Filter/layer changes should always refetch the current viewport.
      engineRef.current.refresh(getMapBbox(mapRef.current), true);
    };
    return on("layers-changed", handler);
  }, [store.activeLayers]);

  // Keep the camera's idea of "centre" aligned with the part of the map the chrome leaves
  // visible. The shell publishes its widths and the sheet height as custom properties on
  // `<html>`, including while the sheet is being dragged, so this follows the finger.
  useEffect(() => {
    let frame = 0;
    let retry = 0;
    const apply = () => {
      frame = 0;
      const map = mapRef.current;
      if (!map) return;
      const padding = chromeMapPadding(readChromeInsets(), {
        width: window.innerWidth,
        height: window.innerHeight
      });
      const current = map.getPadding();
      if (
        current.top === padding.top &&
        current.right === padding.right &&
        current.bottom === padding.bottom &&
        current.left === padding.left
      )
        return;
      // `setPadding` moves the camera, which aborts a flight in progress — a location fix would
      // stop halfway because opening a panel wrote a custom property. Wait for the camera.
      if (map.isMoving() || map.isZooming() || map.isRotating()) {
        window.clearTimeout(retry);
        retry = window.setTimeout(schedule, 150);
        return;
      }
      map.setPadding(padding, { duration: 0 });
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { attributeFilter: ["style"] });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(retry);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, []);

  // The selected pin keeps its place: opening a detail must not re-frame the map under the
  // user's hands. The camera only moves when the pin itself would end up behind the panel.
  useEffect(() => {
    let animation = 0;
    let shownId: string | null = null;
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const stopPulse = () => {
      if (!animation) return;
      cancelAnimationFrame(animation);
      animation = 0;
    };

    const pulse = (map: maplibregl.Map, startedAt: number) => {
      if (!map.getLayer("selected-pin-pulse")) return;
      const phase = ((performance.now() - startedAt) % 1600) / 1600;
      map.setPaintProperty("selected-pin-pulse", "circle-radius", 12 + phase * 14);
      map.setPaintProperty("selected-pin-pulse", "circle-stroke-opacity", 0.9 * (1 - phase));
      animation = requestAnimationFrame(() => pulse(map, startedAt));
    };

    const revealBehindPanel = (map: maplibregl.Map, coordinates: [number, number]) => {
      const { sidebarWidth, sheetHeight } = readChromeInsets();
      const point = map.project(coordinates);
      const hiddenByPanel = sidebarWidth ? sidebarWidth + 24 - point.x : 0;
      const sheetTop = window.innerHeight - sheetHeight - 24;
      const hiddenBySheet = sheetHeight ? point.y - sheetTop : 0;
      if (hiddenByPanel > 0 || hiddenBySheet > 0) {
        map.panBy([-Math.max(hiddenByPanel, 0), Math.max(hiddenBySheet, 0)], { duration: 300 });
      }
    };

    const update = () => {
      const map = mapRef.current;
      const source = map?.getSource("selected-pin") as maplibregl.GeoJSONSource | undefined;
      if (!map || !source) return;
      const pin = store.selectedPin;
      if (!pin) {
        stopPulse();
        shownId = null;
        source.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      const id = `${pin.layerId}:${String(pin.feature.properties.id ?? "")}`;
      if (id === shownId) return;
      shownId = id;
      const coordinates = pin.feature.geometry.coordinates as [number, number];
      map.setPaintProperty(
        "selected-pin-pulse",
        "circle-stroke-color",
        store.theme === "dark" ? "#8ab4f8" : "#1e4fd8"
      );
      source.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: { type: "Point", coordinates }, properties: {} }]
      });
      revealBehindPanel(map, coordinates);
      stopPulse();
      if (!reducedMotion) pulse(map, performance.now());
    };

    update();
    const unsubscribe = store.subscribe(update);
    return () => {
      stopPulse();
      unsubscribe();
    };
  }, [store]);

  useEffect(() => {
    let lastFittedRoute: typeof store.routePreview = null;
    const updateRoute = () => {
      const map = mapRef.current;
      if (!map?.getSource("route-preview")) return;
      const route = store.routePreview;
      const src = map.getSource("route-preview") as maplibregl.GeoJSONSource;
      const stopCoordinates = route?.stops?.map((stop) => stop.coordinates) ?? [];
      if (!route || (!route.coordinates.length && !stopCoordinates.length)) {
        src.setData({ type: "FeatureCollection", features: [] });
        lastFittedRoute = null;
        return;
      }
      const segmentFeatures = route.segments?.length
        ? route.segments.map((segment) => ({
            type: "Feature" as const,
            geometry: { type: "LineString" as const, coordinates: segment.coordinates },
            properties: {
              kind: "route",
              segmentId: segment.id,
              order: segment.order,
              selected: segment.id === store.selectedRouteSegmentId
            }
          }))
        : route.coordinates.length >= 2
          ? [
              {
                type: "Feature" as const,
                geometry: { type: "LineString" as const, coordinates: route.coordinates },
                properties: { kind: "route", selected: false }
              }
            ]
          : [];
      src.setData({
        type: "FeatureCollection",
        features: [
          ...(route.alternatives ?? []).map((alternative) => ({
            type: "Feature" as const,
            geometry: { type: "LineString" as const, coordinates: alternative.coordinates },
            properties: {
              kind: "alternative",
              segmentId: alternative.segmentId,
              alternativeId: alternative.alternativeId
            }
          })),
          ...segmentFeatures,
          ...(route.stops ?? []).map((stop) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: stop.coordinates },
            properties: { kind: "stop", order: stop.order, name: stop.name }
          }))
        ]
      });
      if (lastFittedRoute === route) return;
      lastFittedRoute = route;
      const fittedCoordinates = route.segments?.length
        ? route.segments.flatMap((segment) => segment.coordinates)
        : route.coordinates.length
          ? route.coordinates
          : stopCoordinates;
      const bounds = fittedCoordinates.reduce(
        (b, coord) => b.extend(coord as [number, number]),
        new maplibregl.LngLatBounds(fittedCoordinates[0]!, fittedCoordinates[0]!)
      );
      // The camera padding already describes what the chrome covers, so the fit only has to
      // add a little slack around the route itself.
      map.fitBounds(bounds, { padding: 24, maxZoom: 15 });
    };
    updateRoute();
    return store.subscribe(updateRoute);
  }, [store]);

  return <div ref={containerRef} className="map-container" data-testid="map-container" />;
}
