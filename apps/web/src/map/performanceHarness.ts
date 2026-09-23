import { registerLayer } from "../layers";
import { createDataLayer } from "../layers/dataLayer";
import { createPinsLayerHandle } from "../layers/pinsLayer";
import { getMapStore } from "../store/mapStore";

/** Imported only by the explicit local benchmark build, never the deployed production build. */
export function installPerformanceHarness() {
  const store = getMapStore();
  Object.defineProperty(window, "__maposPerformance", {
    value: {
      addLayers(count: number, pins = false) {
        if (![6, 12].includes(count)) throw new Error("Unsupported benchmark layer count");
        for (let index = 0; index < count - 2; index++) {
          const id = `perf-${index}`;
          registerLayer({
            kind: "pins",
            manifest: {
              id,
              name: id,
              description: "Deterministic performance fixture",
              icon: "place",
              color: "#2563eb",
              category: "environment"
            },
            create: (context) =>
              pins
                ? createPinsLayerHandle(context.map, context.apiBaseUrl, context.layerId, "#2563eb")
                : createDataLayer(context.map, context.apiBaseUrl, context.layerId, {
                    color: "#2563eb"
                  })
          });
          store.toggleLayer(id);
        }
      },
      toggleLayer() {
        store.toggleLayer("perf-0");
      },
      setBasemap(index: number) {
        store.setBasemap(index % 2 ? "carto-voyager" : "carto-positron");
      }
    }
  });
}
