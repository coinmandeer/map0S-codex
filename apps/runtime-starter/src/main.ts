import type maplibregl from "maplibre-gl";
import type { LngLatBoundsLike, StyleSpecification } from "maplibre-gl";
import {
  assertMapOSFeatureV2,
  featureV2ToV1,
  type FeatureCollection,
  type LayerHandle,
  type LayerManifestV2,
  type MapOSFeatureV2
} from "@mapos/layer-sdk";
import {
  LayerRuntimeRegistry,
  MapLibreDataLayerLifecycle,
  type RuntimeLayerRegistration
} from "@mapos/map-runtime";
import fixtureDocument from "./fixtures/clean-room-layers.json";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

interface StaticLayerFixture {
  manifest: LayerManifestV2;
  features: MapOSFeatureV2[];
}

const registry = new LayerRuntimeRegistry<StaticLayerFixture>();
for (const rawFixture of fixtureDocument.layers) {
  const fixture = rawFixture as StaticLayerFixture;
  fixture.features.forEach(assertMapOSFeatureV2);
  registry.register({ manifest: fixture.manifest, value: fixture });
}

const registrations = registry.available({
  renderers: ["circles"],
  sources: ["static"],
  layer: ["query", "detail", "export"]
});
const featureCount = registrations.reduce((sum, item) => sum + item.value.features.length, 0);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Starter document is missing ${selector}`);
  return element;
}

const status = requiredElement<HTMLParagraphElement>("#runtime-status");
const layerList = requiredElement<HTMLDivElement>("#layer-list");
const fallback = requiredElement<HTMLParagraphElement>("#map-fallback");
const fitButton = requiredElement<HTMLButtonElement>("#fit-features");

let map: maplibregl.Map | null = null;
let lifecycle: MapLibreDataLayerLifecycle | null = null;
const allCoordinates: [number, number][] = [];

function focusFeature(featureId: string, coordinates: [number, number]): void {
  if (!map) {
    status.textContent = "The accessible list is ready; the optional map is unavailable.";
    return;
  }
  if (reducedMotion) {
    map.jumpTo({ center: coordinates, zoom: 15 });
    document.body.dataset.cameraTransition = "jump";
  } else {
    map.flyTo({ center: coordinates, zoom: 15 });
    document.body.dataset.cameraTransition = "fly";
  }
  document.body.dataset.cameraAction = `focus:${featureId}`;
}

function renderAccessibleList(registration: RuntimeLayerRegistration<StaticLayerFixture>): void {
  const section = document.createElement("section");
  section.className = "fixture-layer";
  section.dataset.runtimeLayer = registration.manifest.id;
  const heading = document.createElement("h3");
  heading.textContent = registration.manifest.name;
  const description = document.createElement("p");
  description.textContent = registration.manifest.description;
  const list = document.createElement("ol");
  list.setAttribute("aria-label", `${registration.manifest.name} features`);

  for (const feature of registration.value.features) {
    if (feature.geometry.type !== "Point") continue;
    const coordinates = feature.geometry.coordinates as [number, number];
    allCoordinates.push(coordinates);
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = feature.properties.title;
    button.addEventListener("click", () => focusFeature(feature.id, coordinates));
    item.append(button);
    if (feature.properties.summary) {
      item.append(document.createTextNode(` — ${feature.properties.summary}`));
    }
    list.append(item);
  }

  section.append(heading, description, list);
  layerList.append(section);
}

// Complete the primary UI before MapLibre is constructed. WebGL is only an enhancement: every
// data item and primary action is already exposed to keyboard and screen-reader users.
registrations.forEach(renderAccessibleList);
status.textContent = `${registrations.length} manifests accepted · ${featureCount} places · accessible list ready`;
document.body.dataset.listState = "ready";

const emptyStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#e8eee8" } }]
};

function staticLayerHandle(
  runtimeMap: maplibregl.Map,
  registration: RuntimeLayerRegistration<StaticLayerFixture>
): LayerHandle {
  const sourceId = `runtime-source-${registration.manifest.id}`;
  const layerId = `runtime-layer-${registration.manifest.id}`;
  const data: FeatureCollection = {
    type: "FeatureCollection",
    features: registration.value.features.map(featureV2ToV1)
  };
  runtimeMap.addSource(sourceId, { type: "geojson", data });
  runtimeMap.addLayer({
    id: layerId,
    type: "circle",
    source: sourceId,
    paint: {
      "circle-color": registration.manifest.color ?? "#278344",
      "circle-radius": 9,
      "circle-stroke-width": 3,
      "circle-stroke-color": "#ffffff"
    }
  });

  return {
    update: async () => data,
    setData: (next) =>
      (runtimeMap.getSource(sourceId) as maplibregl.GeoJSONSource | undefined)?.setData(next),
    setVisible: (visible) => {
      if (runtimeMap.getLayer(layerId)) {
        runtimeMap.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
      }
    },
    setOpacity: (opacity) => {
      if (runtimeMap.getLayer(layerId))
        runtimeMap.setPaintProperty(layerId, "circle-opacity", opacity);
    },
    detach: () => {
      if (runtimeMap.getLayer(layerId)) runtimeMap.removeLayer(layerId);
      if (runtimeMap.getSource(sourceId)) runtimeMap.removeSource(sourceId);
    }
  };
}

function fitAll(): void {
  if (!map || allCoordinates.length === 0) return;
  const longitudes = allCoordinates.map(([longitude]) => longitude);
  const latitudes = allCoordinates.map(([, latitude]) => latitude);
  const bounds = [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)]
  ] as LngLatBoundsLike;
  map.fitBounds(bounds as LngLatBoundsLike, {
    padding: 72,
    maxZoom: 14,
    duration: reducedMotion ? 0 : 500
  });
  document.body.dataset.cameraTransition = reducedMotion ? "jump" : "fit";
}
fitButton.addEventListener("click", fitAll);

async function initialiseOptionalMap(): Promise<void> {
  try {
    // The heavy renderer is intentionally a second chunk. The list above is interactive before
    // the browser downloads, parses or attempts to initialise MapLibre/WebGL.
    const maplibre = await import("maplibre-gl");
    const runtimeMap = new maplibre.default.Map({
      container: "map",
      style: emptyStyle,
      center: [14.416, 50.1],
      zoom: 12,
      cooperativeGestures: true,
      fadeDuration: reducedMotion ? 0 : 300
    });
    map = runtimeMap;
    lifecycle = new MapLibreDataLayerLifecycle(runtimeMap);
    runtimeMap.addControl(
      new maplibre.default.NavigationControl({ showCompass: false }),
      "top-right"
    );
    runtimeMap.once("load", () => {
      for (const registration of registrations) {
        const handle = lifecycle?.attach({
          id: registration.manifest.id,
          create: () => staticLayerHandle(runtimeMap, registration)
        });
        const collection: FeatureCollection = {
          type: "FeatureCollection",
          features: registration.value.features.map(featureV2ToV1)
        };
        handle?.setData?.(collection);
      }
      document.body.dataset.mapState = "ready";
      status.textContent = `${registrations.length} runtime layers ready · ${featureCount} places`;
      fitAll();
    });
    runtimeMap.on("error", () => {
      status.textContent = "The data layers are ready; the optional map is currently unavailable.";
    });
  } catch {
    lifecycle?.destroy();
    lifecycle = null;
    map = null;
    fallback.hidden = false;
    document.body.dataset.mapState = "unavailable";
    status.textContent = "The accessible data list is ready; WebGL map rendering is unavailable.";
  }
}

void initialiseOptionalMap();

window.addEventListener("pagehide", () => lifecycle?.destroy(), { once: true });
