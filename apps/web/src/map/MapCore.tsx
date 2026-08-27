import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { MAP_STYLE_RASTER_FALLBACK, MAP_STYLE_RASTER_FALLBACK_DARK } from "./mapStyle";
import type { DataProvider } from "@mapos/layer-sdk";
import { applyMapStyle, MapyLogoControl, styleForProvider } from "./styleManager";
import { getMapStore, getMapBbox, type LayerMode } from "../store/mapStore";
import { LayerEngine } from "../engine/LayerEngine";
import { API_BASE } from "../lib/api";
import { emit, on, onAny } from "../lib/events";
import { geolocation } from "../lib/geolocation";

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

    const map = new maplibregl.Map({
      container: el,
      style: styleForProvider(store.theme, store.dataProvider),
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

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    let fallbackApplied = false;
    map.on("error", (event) => {
      console.warn("MapLibre error:", event.error?.message ?? event);
      if (fallbackApplied) return;
      fallbackApplied = true;
      map.setStyle(
        store.theme === "dark" ? MAP_STYLE_RASTER_FALLBACK_DARK : MAP_STYLE_RASTER_FALLBACK
      );
    });

    const resize = () => {
      map.resize();
    };
    resize();
    requestAnimationFrame(resize);
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);

    map.on("moveend", () => {
      if (!map.isStyleLoaded()) return;
      const center = map.getCenter();
      const zoom = map.getZoom();
      if (!Number.isFinite(center.lng) || !Number.isFinite(center.lat) || zoom < 1) return;
      store.setView({ lng: center.lng, lat: center.lat, zoom });
      engineRef.current?.refresh(getMapBbox(map), false);
    });

    // Collected so teardown is one loop instead of a hand-maintained list of removeEventListener
    // calls that has to stay in step with the registrations above it.
    const offs: Array<() => void> = [];

    offs.push(
      on("fly-to", (detail) => {
        map.flyTo({
          center: [detail.lng, detail.lat],
          zoom: detail.zoom ?? 14,
          essential: true
        });
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
          pitch: cameraMode === "follow" ? 60 : 0,
          zoom: cameraMode === "follow" ? 18.2 : Math.max(map.getZoom(), 14),
          duration: 600
        });
      } else {
        map.easeTo({ pitch: 0, duration: 600 });
      }
    };
    offs.push(on("mode-changed", onModeChanged));

    offs.push(
      on("game-camera-changed", (detail) => {
        if (store.mode !== "game") return;
        map.easeTo({
          pitch: detail.mode === "follow" ? 60 : 0,
          zoom: detail.mode === "follow" ? 18.2 : Math.max(map.getZoom(), 14),
          duration: 500
        });
      })
    );

    offs.push(
      on("geolocation", (detail) => {
        if (store.mode !== "game" || store.gameCameraMode !== "follow") return;
        map.easeTo({
          center: [detail.lng, detail.lat],
          duration: 200,
          essential: true
        });
        emit("map-bearing", { bearing: map.getBearing() });
      })
    );

    const onCountryOrTag = () => {
      if (map.isStyleLoaded()) engineRef.current?.refresh(getMapBbox(map), true);
    };
    offs.push(onAny(["country-changed", "tag-changed"], onCountryOrTag));

    // The Mapy logo control is a licence condition, so its lifetime is bound to the provider
    // rather than to the style: it goes on when Mapy tiles appear and off when they don't.
    const mapyLogo = new MapyLogoControl();
    const syncProviderChrome = (provider: DataProvider) => {
      const shouldShow = provider === "mapy";
      if (shouldShow && !map.hasControl(mapyLogo)) map.addControl(mapyLogo, "bottom-left");
      if (!shouldShow && map.hasControl(mapyLogo)) map.removeControl(mapyLogo);
    };
    syncProviderChrome(store.dataProvider);

    offs.push(
      on("theme-changed", (detail) => {
        applyMapStyle(map, detail.theme, store.dataProvider);
      })
    );

    offs.push(
      on("provider-changed", (detail) => {
        syncProviderChrome(detail.provider);
        applyMapStyle(map, store.theme, detail.provider);
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

      if (store.mode === "discover" && map.getLayer("discover-fill")) {
        const regionHits = map.queryRenderedFeatures(e.point, { layers: ["discover-fill"] });
        if (regionHits[0]?.properties) {
          emit("discover-click", regionHits[0].properties);
          return;
        }
      }

      const pinLayers =
        map
          .getStyle()
          .layers?.filter((l) => l.id.startsWith("pins-") && !l.id.includes("-cluster"))
          .map((l) => l.id) ?? [];

      if (!pinLayers.length) return;

      const features = map.queryRenderedFeatures(e.point, { layers: pinLayers });
      if (features.length > 0) {
        const f = features[0]!;
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
      }
    });

    const initOverlays = () => {
      resize();
      if (!engineRef.current) {
        engineRef.current = new LayerEngine(map, API_BASE, store);
      }
      engineRef.current.refresh(getMapBbox(map), true);

      if (!map.getSource("route-preview")) {
        map.addSource("route-preview", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] }
        });
        map.addLayer({
          id: "route-preview-line",
          type: "line",
          source: "route-preview",
          paint: {
            "line-color": "#3b82f6",
            "line-width": 4,
            "line-opacity": 0.85
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
            "fill-color": "#B7791F",
            "fill-opacity": 0.14
          }
        });
        map.addLayer({
          id: "discover-line",
          type: "line",
          source: "discover-regions",
          paint: {
            "line-color": "#B7791F",
            "line-width": 2,
            "line-opacity": 0.85
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
      if (store.mode === "game") {
        map.easeTo({
          pitch: store.gameCameraMode === "follow" ? 60 : 0,
          zoom: store.gameCameraMode === "follow" ? 18.2 : map.getZoom(),
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
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
      for (const off of offs) off();
      geoWatchRef.current?.();
      geoWatchRef.current = null;
      engineRef.current?.destroy();
      engineRef.current = null;
      map.remove();
      mapRef.current = null;
      if (import.meta.env.DEV) delete window.__maposMap;
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      if (!mapRef.current || !engineRef.current) return;
      engineRef.current.syncLayers(store.activeLayers);
      // Filter/layer changes should always refetch the current viewport.
      engineRef.current.refresh(getMapBbox(mapRef.current), true);
    };
    return on("layers-changed", handler);
  }, [store.activeLayers]);

  useEffect(() => {
    const updateRoute = () => {
      const map = mapRef.current;
      if (!map?.getSource("route-preview")) return;
      const route = store.routePreview;
      const src = map.getSource("route-preview") as maplibregl.GeoJSONSource;
      if (!route?.coordinates.length) {
        src.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      src.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "LineString", coordinates: route.coordinates },
            properties: {}
          }
        ]
      });
      const bounds = route.coordinates.reduce(
        (b, coord) => b.extend(coord as [number, number]),
        new maplibregl.LngLatBounds(route.coordinates[0]!, route.coordinates[0]!)
      );
      map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
    };
    updateRoute();
    return store.subscribe(updateRoute);
  }, [store]);

  return <div ref={containerRef} className="map-container" data-testid="map-container" />;
}
