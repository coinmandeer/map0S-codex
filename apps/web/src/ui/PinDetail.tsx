import { useEffect, useMemo, useState } from "react";
import type { GeoFeature, Place } from "@mapos/layer-sdk";
import { distanceMeters } from "@mapos/layer-sdk";
import { getMapStore } from "../store/mapStore";
import { emit } from "../lib/events";
import { geolocation, messageFor, type Fix } from "../lib/geolocation";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { fetchPlaceDetail, placeRefsFromFeature, type PlaceRefs } from "../lib/placeDetail";
import { InfoEngine } from "../info";
import { preloadPlacePhotos, resolvePhotoUrl } from "./photoCache";
import { saveUserPlace } from "./saveUserContent";
import { API_BASE } from "../lib/api";

function googleMapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 900 : false
  );
  useEffect(() => {
    const onResize = () => setDesktop(window.innerWidth >= 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return desktop;
}

function photoOpts(feature: GeoFeature) {
  return {
    photo: typeof feature.properties.photo === "string" ? feature.properties.photo : null,
    wikidata: typeof feature.properties.wikidata === "string" ? feature.properties.wikidata : null
  };
}

/** The place as the map already knows it. Rendered immediately, then replaced by the server's
 *  fuller record — the detail must open at click speed, not at network speed. */
const SERVICE_LABELS: Record<string, string> = {
  water: "💧 Voda",
  electricity: "⚡ Elektřina",
  wifi: "📶 Wifi",
  shower: "🚿 Sprcha",
  toilets: "🚻 WC"
};

function placeFromPin(refs: PlaceRefs, feature: GeoFeature): Place {
  const p = feature.properties;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
  // Park4Night's amenities and a user pin's tags are the same thing to a reader.
  const tags = [...list(p.tags), ...list(p.services).map((s) => SERVICE_LABELS[s] ?? s)];

  return {
    id: refs.id,
    name: refs.name,
    lng: refs.lng,
    lat: refs.lat,
    category: refs.category,
    wikidata: refs.wikidata ?? undefined,
    fsqId: refs.fsqId ?? undefined,
    website: str(p.website),
    phone: str(p.phone),
    openingHours: str(p.opening_hours),
    description: str(p.description),
    photo: str(p.photo),
    rating: num(p.rating),
    ratingCount: num(p.reviews),
    elevationM: p.ele !== undefined ? Number(p.ele) : undefined,
    tags: tags.length ? tags : undefined,
    sources: Object.entries(refs.refs)
      .filter(([, ref]) => ref)
      .map(([source, ref]) => ({
        source: source as Place["sources"][number]["source"],
        sourceRef: ref!,
        confidence: 0.5,
        refreshedAt: new Date().toISOString()
      }))
  };
}

export function PinDetail() {
  const store = getMapStore();
  const pin = useMapStoreSnapshot((s) => s.selectedPin);
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  const visibleFeatures = useMapStoreSnapshot((s) => s.visibleFeatures);
  const view = useMapStoreSnapshot((s) => s.view);
  const desktop = useIsDesktop();

  const nearby = useMemo(() => {
    const all: { feature: GeoFeature; layerId: string; distance: number }[] = [];
    for (const [layerId, state] of Object.entries(active)) {
      if (!state.visible) continue;
      for (const feature of visibleFeatures[layerId] ?? []) {
        const [lng, lat] = feature.geometry.coordinates;
        all.push({ feature, layerId, distance: distanceMeters(view, { lng, lat }) });
      }
    }
    return all.sort((a, b) => a.distance - b.distance).slice(0, 80);
  }, [active, visibleFeatures, view]);

  const index = pin
    ? nearby.findIndex(
        (p) => p.layerId === pin.layerId && p.feature.properties.id === pin.feature.properties.id
      )
    : -1;

  const goTo = (delta: number) => {
    if (index < 0) return;
    const next = nearby[index + delta];
    if (!next) return;
    const [nLng, nLat] = next.feature.geometry.coordinates;
    emit("fly-to", { lng: nLng, lat: nLat, zoom: 16 });
    store.selectPin({ feature: next.feature, layerId: next.layerId });
  };

  useEffect(() => {
    if (index < 0) return;
    const around = nearby.slice(Math.max(0, index - 2), index + 3).map((p) => photoOpts(p.feature));
    preloadPlacePhotos(around);
  }, [index, nearby]);

  useEffect(() => {
    if (!pin || index < 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pin, index, nearby]);

  const refs = useMemo(() => (pin ? placeRefsFromFeature(pin.feature, pin.layerId) : null), [pin]);
  const [place, setPlace] = useState<Place | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);

  useEffect(() => {
    if (!pin || !refs) return;
    const controller = new AbortController();
    const local = placeFromPin(refs, pin.feature);
    setPlace(local);

    const initial = local.photo ?? null;
    setPhotos(initial ? [initial] : []);

    void (async () => {
      const [wiki, detail] = await Promise.all([
        resolvePhotoUrl(photoOpts(pin.feature)),
        fetchPlaceDetail(refs, controller.signal)
      ]);
      if (controller.signal.aborted) return;

      // The server fills gaps; it never overwrites what the pin already showed, so the panel
      // doesn't visibly rewrite itself a second after opening.
      if (detail) {
        setPlace({
          ...local,
          ...Object.fromEntries(Object.entries(detail).filter(([, v]) => v !== undefined)),
          name: local.name || detail.name,
          tags: local.tags ?? detail.tags,
          sources: detail.sources.length ? detail.sources : local.sources
        } as Place);
      }
      const gallery = [wiki, initial, detail?.photo].filter(
        (url, i, arr): url is string => Boolean(url) && arr.indexOf(url) === i
      );
      setPhotos(gallery);
    })();

    return () => controller.abort();
  }, [pin, refs]);

  if (!pin || !refs || !place) return null;

  const { lng, lat } = refs;
  const externalUrl =
    typeof pin.feature.properties.externalUrl === "string"
      ? pin.feature.properties.externalUrl
      : null;

  const planRoute = async (profile: "foot" | "bike" | "car" = "car") => {
    let fix: Fix;
    try {
      fix = await geolocation.getPosition();
    } catch (error) {
      store.showToast(messageFor(error));
      return;
    }
    try {
      const from = `${fix.lng},${fix.lat}`;
      const to = `${lng},${lat}`;
      const res = await fetch(`${API_BASE}/routing?from=${from}&to=${to}&profile=${profile}`);
      const data = await res.json();
      store.setRoutePreview({
        coordinates: data.coordinates,
        distanceM: data.distanceM,
        durationS: data.durationS,
        profile
      });
    } catch {
      store.showToast("Trasu se nepodařilo načíst");
    }
  };

  const savePlace = async () => {
    const result = await saveUserPlace({ name: place.name, lng, lat, kind: "place" });
    if (result === "auth") {
      store.openSheet("auth");
      store.showToast("Přihlas se pro uložení bodu");
      return;
    }
    store.showToast(result === "ok" ? "Bod uložen do mých míst" : "Uložení se nepovedlo");
  };

  return (
    <>
      <div className="overlay" onClick={() => store.closeSheet()} />
      <div className={`panel ${desktop ? "dialog" : "sheet"}`} data-testid="pin-detail">
        {!desktop && <div className="panel-handle" />}
        <div className="panel-header">
          <h2>Detail místa</h2>
          <div className="pin-nav">
            {index >= 0 && nearby.length > 1 && (
              <>
                <button
                  className="btn btn-ghost pin-nav-btn"
                  data-testid="pin-prev"
                  disabled={index <= 0}
                  onClick={() => goTo(-1)}
                  title="Předchozí místo"
                >
                  ‹
                </button>
                <span className="meta pin-nav-count">
                  {index + 1}/{nearby.length}
                </span>
                <button
                  className="btn btn-ghost pin-nav-btn"
                  data-testid="pin-next"
                  disabled={index >= nearby.length - 1}
                  onClick={() => goTo(1)}
                  title="Další místo"
                >
                  ›
                </button>
              </>
            )}
            <button className="btn btn-ghost" onClick={() => store.closeSheet()}>
              ✕
            </button>
          </div>
        </div>
        <div className="panel-body">
          <InfoEngine
            place={place}
            refs={refs.refs}
            photos={photos}
            actions={
              <>
                {externalUrl && (
                  <a
                    className="btn"
                    href={externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="p4n-link"
                  >
                    Otevřít na Park4Night
                  </a>
                )}
                <a
                  className="btn"
                  href={googleMapsLink(lat, lng)}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="nav-google"
                >
                  Google Maps
                </a>
                <button
                  className="btn btn-accent"
                  data-testid="route-car"
                  onClick={() => void planRoute("car")}
                >
                  Trasa
                </button>
                <button className="btn" data-testid="save-place" onClick={() => void savePlace()}>
                  Uložit bod
                </button>
              </>
            }
          />
        </div>
      </div>
    </>
  );
}
