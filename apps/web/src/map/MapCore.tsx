import { getLayerManifestV2 } from "../layers/registry";
import { createPinSpread, type SpreadPin } from "./pinSpread";
import { createPinPreview } from "./pinPreview";
import { interactivePinLayers, interactivePinOwner } from "./interactivePins";
import { fitArea } from "./fitArea";
import { contextClickSuppressed } from "./contextGesture";
import { attachSocialMap } from "../world/socialMap";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { MapLibreDataLayerLifecycle } from "@mapos/map-runtime";
import { MAP_STYLE_RASTER_FALLBACK, MAP_STYLE_RASTER_FALLBACK_DARK } from "./mapStyle";
import { usesMapyTiles } from "@mapos/layer-sdk";
import { MapyLogoControl } from "./styleManager";
import { overlayForBasemap, resolveBasemap, styleForBasemap } from "./basemapStyle";
import { apply3dBuildings } from "./buildings3d";
import { applyTerrain3d } from "./terrain3d";
import { chromeMapPadding, readChromeInsets } from "./chromePadding";
import { getMapStore, getMapBbox, type LayerMode } from "../store/mapStore";
import { getShellStore } from "../store/shellStore";
import { LayerEngine } from "../engine/LayerEngine";
import { attachBoundaryOverlay } from "../discover/boundaryOverlay";
import { activeAttribution } from "../layers/attribution";
import { API_BASE } from "../lib/api";
import { emit, on, onAny } from "../lib/events";
import { geolocation } from "../lib/geolocation";
import { chooseMapClickTarget } from "./mapClickPriority";
import { MAP_RUNTIME_V2_ENABLED, DISCOVER_BOUNDARIES_ENABLED } from "../lib/featureFlags";
import { safeBrowserErrorFields } from "../lib/safeError";
import { browserProviderHealth } from "../tasks/BrowserProviderHealth";
import { directBrowserBasemapProviderId, isBasemapRuntimeError } from "./browserBasemapProvider";

// The previous 18.2 zoom showed roughly one block and made a three-metre avatar feel enormous.
// These views frame the kilometre orb sector: follow stays close enough to read the character,
// while top view shows the board as a board.
const GAME_FOLLOW_PITCH = 52;
const GAME_FOLLOW_ZOOM = 18.3;
const GAME_TOP_ZOOM = 17.2;
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
      zoom: store.mode === "game" ? GAME_FOLLOW_ZOOM : store.view.zoom,
      pitch: store.mode === "game" && store.gameCameraMode === "follow" ? GAME_FOLLOW_PITCH : 0,
      attributionControl: false,
      // Base experience stays a flat 2D map (no user-driven tilt/rotate); pitch is only ever
      // raised programmatically when entering the 3D game mode (see onModeChanged below).
      maxPitch: 65,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 0
    });
    const stopSocialMap = attachSocialMap(map);
    const dataLayerLifecycle = MAP_RUNTIME_V2_ENABLED ? new MapLibreDataLayerLifecycle(map) : null;
    let pendingGameFollow: { lng: number; lat: number } | null = null;
    let gameFollowTimer: ReturnType<typeof setTimeout> | null = null;
    let lastGameFollowAt = 0;
    let pendingViewportRefresh = false;
    let pendingWorldRefresh = false;

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
      engineRef.current?.refresh(getMapBbox(map), pendingWorldRefresh);
      pendingWorldRefresh = false;
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
      store.setViewportBbox(getMapBbox(map));
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
        engineRef.current?.refresh(getMapBbox(map), pendingWorldRefresh);
        pendingWorldRefresh = false;
      } else {
        pendingViewportRefresh = true;
      }
      emitDiscoverViewport();
    });

    // Collected so teardown is one loop instead of a hand-maintained list of removeEventListener
    // calls that has to stay in step with the registrations above it.
    const offs: Array<() => void> = [];
    if (DISCOVER_BOUNDARIES_ENABLED) offs.push(attachBoundaryOverlay(map, store));
    let cameraWorld = store.experienceId;
    const worldCameras = new Map<
      string,
      { center: [number, number]; zoom: number; pitch: number; bearing: number }
    >();
    offs.push(
      on("experience-changed", ({ id }) => {
        map.stop();
        const center = map.getCenter();
        worldCameras.set(cameraWorld, {
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing()
        });
        const target =
          worldCameras.get(id) ??
          (id === "global"
            ? {
                center: [10, 20] as [number, number],
                zoom: map.getContainer().clientWidth < 640 ? 1 : 2,
                pitch: 0,
                bearing: 0
              }
            : undefined);
        const cameFromGlobal = cameraWorld === "global";
        cameraWorld = id;
        if (target && (id === "global" || cameFromGlobal)) {
          const animate =
            store.preferences.flyAnimations &&
            !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          pendingWorldRefresh = true;
          map.easeTo({ ...target, duration: animate ? 700 : 0 });
        }
      })
    );

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

    // Search here is a request, not a hint: pressing it while the style is still settling after a
    // long jump used to clear the button and fetch nothing, so the ask is deferred to the next
    // idle instead of dropped.
    const onSearchHere = () => {
      if (map.isStyleLoaded()) {
        engineRef.current?.refresh(getMapBbox(map), true);
        return;
      }
      map.once("idle", () => engineRef.current?.refresh(getMapBbox(map), true));
    };
    offs.push(on("search-here", onSearchHere));
    offs.push(on("layer-style-changed", () => engineRef.current?.syncLayers(store.activeLayers)));
    offs.push(
      on("refresh-layer", ({ id }) => engineRef.current?.refreshLayer(id, getMapBbox(map)))
    );

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
      on("terrain-3d-changed", (detail) => {
        applyTerrain3d(map, detail.enabled);
        // Relief needs a viewing angle to read as relief, but a gentler one than buildings want:
        // the subject is a range of hills, not a street. Hillshade carries it from overhead, so
        // this is a nudge rather than the full tilt. The game mode runs its own camera.
        if (store.mode === "game") return;
        map.easeTo({ pitch: detail.enabled ? 45 : 0, duration: 700 });
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
        fitArea(map, bbox, { maxZoom: 17, animate: store.preferences.flyAnimations });
      })
    );

    // A pan ends with a DOM click on the canvas, and a pan under a picker means "look over
    // there", not "pick the place my finger happens to be over". So a gesture that dragged is
    // not a tap.
    let dragged = false;
    const armGesture = () => {
      dragged = false;
    };
    map.on("mousedown", armGesture);
    map.on("touchstart", armGesture);
    map.on("dragstart", () => {
      dragged = true;
    });

    map.on("click", (e) => {
      if (contextClickSuppressed(map)) return;
      if (store.editMode && store.editLayerId) {
        emit("edit-tap", { lng: e.lngLat.lng, lat: e.lngLat.lat });
        return;
      }

      // A picker waiting for a point takes the click itself. Dragging the whole map under a
      // fixed centre pin to nominate a place the finger is already on is a step nobody expects,
      // and it made picking a stop feel like it had not registered.
      if (!dragged && getShellStore().snapshot.mapPicker.type === "active") {
        emit("map-picker-tap", { lng: e.lngLat.lng, lat: e.lngLat.lat });
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

      const pinLayers = interactivePinLayers(map);
      const clusterLayers =
        map
          .getStyle()
          .layers?.filter((l) => l.id.startsWith("pins-") && l.id.endsWith("-cluster"))
          .map((l) => l.id) ?? [];

      // Clusters are first-class map targets.  Previously they were excluded from hit testing,
      // so a tap on a large count bubble fell through to the basemap and users had no way to
      // discover the pins hidden beneath it.  Expansion is handled by the worker-side cluster
      // index; no feature payload is fetched or duplicated in the browser.
      const clusterHit = clusterLayers.length
        ? map.queryRenderedFeatures(e.point, { layers: clusterLayers })[0]
        : undefined;
      if (clusterHit) {
        const sourceId = clusterHit.layer?.source;
        const clusterId = Number(clusterHit.properties?.cluster_id);
        const source =
          typeof sourceId === "string"
            ? (map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined)
            : undefined;
        if (source && Number.isFinite(clusterId)) {
          void source
            .getClusterExpansionZoom(clusterId)
            .then(async (zoom) => {
              if (map.getSource(String(sourceId)) !== source) return;
              const coordinates = clusterHit.geometry;
              if (coordinates.type !== "Point") return;
              if (zoom <= map.getZoom() + 0.1 && map.getZoom() >= 12) {
                const layerId = String(sourceId).replace(/^source-/, "");
                const page = async (offset: number) =>
                  (await source.getClusterLeaves(
                    clusterId,
                    100,
                    offset
                  )) as unknown as import("@mapos/layer-sdk").GeoFeature[];
                emit("cluster-list", {
                  features: await page(0),
                  layerId,
                  total: Number(clusterHit.properties?.point_count ?? 0),
                  page
                });
                return;
              }
              map.easeTo({
                center: coordinates.coordinates as [number, number],
                zoom: Math.min(zoom, 17),
                duration: store.preferences.flyAnimations ? 420 : 0,
                essential: false
              });
            })
            .catch(() => undefined);
        }
        return;
      }

      const pinHits = pinLayers.length
        ? map.queryRenderedFeatures(e.point, { layers: pinLayers })
        : [];
      const weatherLayerIds = map
        .getStyle()
        .layers.map((layer) => layer.id)
        .filter((id) => /^fill-weather(?:-[a-z-]+)?-sectors$/.test(id));
      const weatherHit = weatherLayerIds.length
        ? map.queryRenderedFeatures(e.point, { layers: weatherLayerIds })[0]
        : undefined;
      const regionLayerIds = ["discover-boundary-fill", "discover-fill"].filter((id) =>
        Boolean(map.getLayer(id))
      );
      const regionHits =
        store.mode === "discover" && regionLayerIds.length
          ? map.queryRenderedFeatures(e.point, { layers: regionLayerIds })
          : [];
      // Thematic fills sit under everything else, so they are only consulted once nothing
      // clickable was hit above them: a pin standing on a coloured region belongs to the pin.
      const themeLayers =
        map
          .getStyle()
          .layers?.map((layer) => layer.id)
          .filter((id) => /^vt-theme-.+-(fill|nodata)$/.test(id)) ?? [];
      const themeHit =
        !pinHits.length && themeLayers.length
          ? map.queryRenderedFeatures(e.point, { layers: themeLayers })[0]
          : undefined;

      const uniquePins = new Map<string, SpreadPin>();
      for (const hit of pinHits) {
        const owner = interactivePinOwner(map, hit.layer.id);
        if (!owner || hit.geometry.type !== "Point") continue;
        const id = String(hit.properties?.id ?? hit.id ?? hit.geometry.coordinates.join(","));
        uniquePins.set(`${owner}:${id}`, {
          layer: owner,
          feature: {
            type: "Feature",
            geometry: { type: "Point", coordinates: hit.geometry.coordinates as [number, number] },
            properties: {
              ...hit.properties,
              id,
              layerId: owner,
              name: String(hit.properties?.name ?? "Místo")
            }
          }
        });
      }
      if (uniquePins.size > 1) {
        const pins = [...uniquePins.values()];
        const coordinates = pins.map(
          (pin) => (pin.feature.geometry as GeoJSON.Point).coordinates as [number, number]
        );
        const first = map.project(coordinates[0]!);
        const separable = coordinates.some((coordinate) => map.project(coordinate).dist(first) > 4);
        if (separable && map.getZoom() < 18) {
          const bounds = coordinates.reduce(
            (box, coordinate) => box.extend(coordinate),
            new maplibregl.LngLatBounds(coordinates[0]!, coordinates[0]!)
          );
          map.fitBounds(bounds, {
            padding: 100,
            maxZoom: 18,
            duration: store.preferences.flyAnimations ? 180 : 0
          });
        } else if (pins.length <= 12) {
          pinPreview.hide();
          pinSpread.show(pins);
        } else {
          emit("cluster-list", {
            features: pins.map((pin) => pin.feature),
            layerId: pins[0]!.layer,
            total: pins.length
          });
        }
        return;
      }
      pinSpread.hide();
      const target = chooseMapClickTarget(pinHits, regionHits);

      if (target?.kind === "pin") {
        const f = target.feature;
        const props = f.properties as Record<string, string>;
        const layerId = interactivePinOwner(map, f.layer.id) ?? props.layerId;
        if (!layerId) return;
        if (window.matchMedia("(pointer: coarse)").matches) {
          pinPreview.show(f);
          return;
        }
        pinPreview.hide();
        engineRef.current?.handlePinClick(layerId, {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: (f.geometry as GeoJSON.Point).coordinates as [number, number]
          },
          properties: {
            ...props,
            id: props.id ?? String(f.id ?? (f.geometry as GeoJSON.Point).coordinates.join(",")),
            name: props.name ?? props.object_value ?? "Objekt v mapě",
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
      if (themeHit?.properties) {
        const properties = themeHit.properties as Record<string, unknown>;
        const themeId = themeHit.layer.id.replace(/^vt-theme-/, "").replace(/-(fill|nodata)$/, "");
        const code = typeof properties.code === "string" ? properties.code : null;
        if (code) {
          emit("theme-unit-selected", {
            themeId,
            geoLevel: typeof properties.level === "string" ? properties.level : "",
            code,
            name: typeof properties.name === "string" ? properties.name : code
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

    // Avatar owns keyboard navigation while the game is active. Restore the user's prior map setting.
    let priorKeyboard: boolean | null = null;
    const syncGameKeyboard = () => {
      if (store.mode === "game") {
        if (priorKeyboard === null) priorKeyboard = map.keyboard.isEnabled();
        map.keyboard.disable();
      } else if (priorKeyboard !== null) {
        if (priorKeyboard) map.keyboard.enable();
        priorKeyboard = null;
      }
    };
    syncGameKeyboard();
    offs.push(store.subscribe(syncGameKeyboard));

    // One throttled canvas listener provides hover feedback for every pin source.  Feature-state
    // keeps the effect in MapLibre's renderer; there is no React update and no DOM node per POI.
    const pinPreview = createPinPreview(map, (layer, feature) =>
      engineRef.current?.handlePinClick(layer, feature)
    );
    const pinSpread = createPinSpread(map, ({ layer, feature }) =>
      engineRef.current?.handlePinClick(layer, feature)
    );
    let previewLayers = store.activeLayers;
    let previewArea = store.areaSelection;
    let previewMode = store.mode;
    let previewSelection = store.selectedPin;
    offs.push(
      store.subscribe(() => {
        if (
          previewLayers !== store.activeLayers ||
          previewArea !== store.areaSelection ||
          previewMode !== store.mode ||
          previewSelection !== store.selectedPin
        ) {
          pinPreview.hide();
          pinSpread.hide();
          previewLayers = store.activeLayers;
          previewArea = store.areaSelection;
          previewMode = store.mode;
          previewSelection = store.selectedPin;
        }
      })
    );
    let answerHighlights: Array<{ source: string; id: string }> = [];
    const clearAnswerHighlight = () => {
      for (const target of answerHighlights)
        if (map.getSource(target.source)) map.setFeatureState(target, { hover: false });
      answerHighlights = [];
    };
    offs.push(
      on("ai-result-hover", (ref) => {
        clearAnswerHighlight();
        if (!ref) return;
        const seen = new Set<string>();
        for (const layer of interactivePinLayers(map)) {
          const owner = interactivePinOwner(map, layer);
          if (!owner) continue;
          const feature = getLayerManifestV2(owner)?.source.inline?.features.find(
            (f) => f.sourceLayerId === ref.layerId && (f.sourceFeatureId ?? f.id) === ref.featureId
          );
          const id = feature?.id ?? (owner === ref.layerId ? ref.featureId : null);
          const source = map.getLayer(layer)?.source;
          if (!id || typeof source !== "string" || seen.has(source)) continue;
          seen.add(source);
          const target = { source, id };
          map.setFeatureState(target, { hover: true });
          answerHighlights.push(target);
        }
      })
    );
    map.on("movestart", clearAnswerHighlight);
    offs.push(() => {
      map.off("movestart", clearAnswerHighlight);
      clearAnswerHighlight();
    });
    offs.push(on("layers-changed", clearAnswerHighlight));
    let hoveredPin: { source: string; id: string | number } | null = null;
    let hoverFrame = 0;
    let hoverPoint: maplibregl.PointLike | null = null;
    const clearPinHover = () => {
      if (hoveredPin && map.getSource(hoveredPin.source)) {
        map.setFeatureState(hoveredPin, { hover: false });
        hoveredPin = null;
      }
      pinPreview.leave();
      emit("ai-pin-hover", null);
      map.getCanvas().style.cursor = "";
    };
    const paintPinHover = () => {
      hoverFrame = 0;
      if (!hoverPoint || !map.isStyleLoaded()) return;
      const layers = interactivePinLayers(map);
      const hit = layers.length
        ? map.queryRenderedFeatures(hoverPoint, { layers }).find((feature) => feature.id != null)
        : undefined;
      if (!hit || hit.id == null || typeof hit.layer?.source !== "string") {
        clearPinHover();
        return;
      }
      const next = { source: hit.layer.source, id: hit.id as string | number };
      if (hoveredPin?.source === next.source && hoveredPin.id === next.id) {
        pinPreview.show(hit);
        return;
      }
      clearPinHover();
      map.setFeatureState(next, { hover: true });
      hoveredPin = next;
      const owner = interactivePinOwner(map, hit.layer.id);
      if (owner)
        emit("ai-pin-hover", {
          layerId: String(hit.properties.sourceLayerId ?? owner),
          featureId: String(hit.properties.sourceFeatureId ?? hit.properties.id ?? hit.id)
        });
      pinPreview.show(hit);
      map.getCanvas().style.cursor = "pointer";
    };
    map.on("mousemove", (event) => {
      hoverPoint = event.point;
      if (!hoverFrame) hoverFrame = requestAnimationFrame(paintPinHover);
    });
    map.on("mouseout", () => {
      hoverPoint = null;
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      hoverFrame = 0;
      clearPinHover();
    });

    // Hover is tracked here rather than in React: it is pointer feedback, not state anyone
    // else reads, and feature-state keeps it off the render loop. Registered once (not in
    // initOverlays, which re-runs on every basemap switch and would stack listeners).
    let hoveredRegion: string | number | null = null;
    const clearRegionHover = () => {
      if (hoveredRegion === null || !map.getSource("discover-regions")) return;
      map.setFeatureState({ source: "discover-regions", id: hoveredRegion }, { hover: false });
      hoveredRegion = null;
    };
    map.on("mousemove", "discover-fill", (event) => {
      // The selected region is drawn over the candidates where they overlap; hovering it is
      // not a choice being made, so the highlight goes to the candidate underneath.
      const feature =
        event.features?.find((candidate) => candidate.properties?.kind === "candidate") ??
        event.features?.[0];
      const id = feature?.id;
      if (id === undefined || id === hoveredRegion) return;
      clearRegionHover();
      hoveredRegion = id;
      map.setFeatureState({ source: "discover-regions", id }, { hover: true });
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "discover-fill", () => {
      clearRegionHover();
      pinPreview.leave();
      map.getCanvas().style.cursor = "";
    });

    const initOverlays = () => {
      resize();
      if (!engineRef.current) {
        engineRef.current = new LayerEngine(map, API_BASE, store, undefined, dataLayerLifecycle);
      }
      engineRef.current.restoreStyle(getMapBbox(map));
      // Extrusions and the terrain mesh live in the style, so they are gone after every
      // background switch and have to be re-added here rather than only when a toggle is flipped.
      apply3dBuildings(map, store.buildings3d);
      applyTerrain3d(map, store.terrain3d);

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
            // Red, and thicker: the highlighted segment has to read as "this one" against a
            // blue route on any basemap, including satellite.
            "line-color": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              "#ef4444",
              "#2563eb"
            ],
            "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 8, 5],
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
          layout: { visibility: DISCOVER_BOUNDARIES_ENABLED ? "none" : "visible" },
          type: "fill",
          source: "discover-regions",
          paint: {
            "fill-color": ["case", ["==", ["get", "kind"], "selected"], "#B7791F", "#2563EB"],
            // The pointer needs to say which region it is over before the click: without it the
            // outlines are scenery rather than something you can choose from.
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              0.22,
              ["==", ["get", "kind"], "selected"],
              0.14,
              0.07
            ]
          }
        });
        map.addLayer({
          id: "discover-line",
          layout: { visibility: DISCOVER_BOUNDARIES_ENABLED ? "none" : "visible" },
          type: "line",
          source: "discover-regions",
          paint: {
            "line-color": ["case", ["==", ["get", "kind"], "selected"], "#B7791F", "#2563EB"],
            "line-width": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              2.5,
              ["==", ["get", "kind"], "selected"],
              2,
              1.25
            ],
            "line-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              0.95,
              ["==", ["get", "kind"], "selected"],
              0.85,
              0.62
            ]
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
    if (import.meta.env.DEV || import.meta.env.MODE === "performance") window.__maposMap = map;

    return () => {
      pinPreview.destroy();
      pinSpread.destroy();
      if (gameFollowTimer) clearTimeout(gameFollowTimer);
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
      for (const off of offs) off();
      geoWatchRef.current?.();
      geoWatchRef.current = null;
      engineRef.current?.destroy();
      engineRef.current = null;
      dataLayerLifecycle?.destroy();
      stopSocialMap();
      map.remove();
      mapRef.current = null;
      if (import.meta.env.DEV || import.meta.env.MODE === "performance") delete window.__maposMap;
    };
  }, [store]);

  useEffect(() => {
    const handler = () => {
      if (!mapRef.current || !engineRef.current) return;
      engineRef.current.syncLayers(store.activeLayers);
      // The engine compares per-layer query keys; visual changes never trigger a fetch.
      engineRef.current.refresh(getMapBbox(mapRef.current));
    };
    return on("layers-changed", handler);
  }, [store]);

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
    let lastHighlighted: string | null = null;
    let lastRouteSource: maplibregl.GeoJSONSource | undefined;
    let lastWrittenRoute: typeof store.routePreview | undefined;
    const updateRoute = () => {
      const map = mapRef.current;
      if (!map?.getSource("route-preview")) return;
      const route = store.routePreview;
      const src = map.getSource("route-preview") as maplibregl.GeoJSONSource;
      const stopCoordinates = route?.stops?.map((stop) => stop.coordinates) ?? [];
      if (!route || (!route.coordinates.length && !stopCoordinates.length)) {
        if (lastRouteSource !== src || lastWrittenRoute !== route)
          src.setData({ type: "FeatureCollection", features: [] });
        lastFittedRoute = null;
        lastRouteSource = src;
        lastWrittenRoute = route;
        lastHighlighted = null;
        return;
      }
      const needsWrite = lastRouteSource !== src || lastWrittenRoute !== route;
      const segmentFeatures =
        needsWrite && route.segments?.length
          ? route.segments.map((segment) => ({
              type: "Feature" as const,
              id: segment.id,
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
      if (needsWrite) {
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
        lastRouteSource = src;
        lastWrittenRoute = route;
      }
      // "Highlight on map" should take the map there: the row is in a panel, and a segment
      // recoloured somewhere off screen looks like nothing happened.
      const highlighted = store.selectedRouteSegmentId;
      if (lastHighlighted && lastHighlighted !== highlighted)
        map.setFeatureState({ source: "route-preview", id: lastHighlighted }, { selected: false });
      if (highlighted && (needsWrite || highlighted !== lastHighlighted))
        map.setFeatureState({ source: "route-preview", id: highlighted }, { selected: true });
      if (highlighted && highlighted !== lastHighlighted) {
        lastHighlighted = highlighted;
        const segment = route.segments?.find((candidate) => candidate.id === highlighted);
        const coordinates = segment?.coordinates ?? [];
        if (coordinates.length) {
          const segmentBounds = coordinates.reduce(
            (box, coord) => box.extend(coord as [number, number]),
            new maplibregl.LngLatBounds(
              coordinates[0] as [number, number],
              coordinates[0] as [number, number]
            )
          );
          map.fitBounds(segmentBounds, { padding: 64, maxZoom: 16 });
        }
      } else if (!highlighted) {
        lastHighlighted = null;
      }
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
    const off = store.subscribe(updateRoute);
    const map = mapRef.current;
    map?.on("style.load", updateRoute);
    return () => {
      off();
      map?.off("style.load", updateRoute);
    };
  }, [store]);

  return <div ref={containerRef} className="map-container" data-testid="map-container" />;
}
