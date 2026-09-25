import { addDiscoveredPlace } from "../info/appendDiscoveredPlace";
import { useEffect, useState, useRef } from "react";
import { on, emit } from "../lib/events";
import { apiGet } from "../lib/api";
import { getMapStore } from "../store/mapStore";
import { createSavedPlaceFromFeature } from "../lib/savedPlaces";
import { worldRuntime } from "../world/runtime";
import type { GeoFeature } from "@mapos/layer-sdk";

export function MapPlaceContext() {
  const [point, setPoint] = useState<{ lng: number; lat: number; x: number; y: number } | null>(
    null
  );
  const host = useRef<HTMLElement>(null);
  const dismiss = () => emit("map-place-context", null);
  const [name, setName] = useState("Místo na mapě");
  const [loading, setLoading] = useState(false);
  useEffect(() => on("map-place-context", setPoint), []);
  useEffect(() => {
    if (!point) return;
    setName("Místo na mapě");
    setLoading(true);
    const controller = new AbortController();
    void apiGet<{ name: string | null }>("/geocode/reverse", {
      query: { lng: String(point.lng), lat: String(point.lat) },
      signal: controller.signal
    })
      .then((r) => {
        if (!controller.signal.aborted) setName(r.name || "Místo na mapě");
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    const outside = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) dismiss();
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", close);
    return () => {
      controller.abort();
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", outside);
    };
  }, [point]);
  if (!point) return null;
  const store = getMapStore();
  const feature: GeoFeature = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lng, point.lat] },
    properties: {
      id: `map:${point.lng.toFixed(6)},${point.lat.toFixed(6)}`,
      layerId: "map-point",
      name,
      category: "place"
    }
  };
  return (
    <section
      ref={host}
      role="dialog"
      aria-label="Místo na mapě"
      className="map-place-menu"
      style={{
        left: Math.max(12, Math.min(point.x + 12, window.innerWidth - 292)),
        top: Math.max(76, Math.min(point.y + 12, window.innerHeight - 310))
      }}
    >
      <button className="map-place-close" aria-label="Zavřít místo" onClick={() => dismiss()}>
        ×
      </button>
      <strong>{loading ? "Zjišťuji místo…" : name}</strong>
      <small>
        {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
      </small>
      <button
        onClick={() => {
          store.selectPin({ layerId: "map-point", feature });
          dismiss();
        }}
      >
        Detail místa
      </button>
      <button
        onClick={() => {
          worldRuntime.openSocial({ lng: point.lng, lat: point.lat });
          dismiss();
        }}
      >
        Zanechat zprávu
      </button>
      <button
        onClick={() => {
          addDiscoveredPlace({
            id: `coordinate:${point.lng},${point.lat}`,
            name,
            lng: point.lng,
            lat: point.lat
          });
          dismiss();
        }}
      >
        Přidat do trasy
      </button>
      <button
        onClick={() =>
          void createSavedPlaceFromFeature(feature, "map-point")
            .then((result) => {
              if (result === "auth") store.openSheet("auth");
              else {
                store.showToast(
                  result === "ok"
                    ? "Místo uloženo"
                    : result === "exists"
                      ? "Místo už je uložené"
                      : "Místo se nepodařilo uložit"
                );
                if (result === "ok") emit("layers-changed");
              }
              dismiss();
            })
            .catch(() => store.showToast("Místo se nepodařilo uložit. Zkus to znovu."))
        }
      >
        Uložit místo
      </button>
    </section>
  );
}
