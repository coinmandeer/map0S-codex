import { useEffect, useMemo, useState } from "react";
import type { GeoFeature } from "@mapos/layer-sdk";
import { distanceMeters } from "@mapos/layer-sdk";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { PIN_STYLES } from "./presets";
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

const SERVICE_LABELS: Record<string, string> = {
  water: "💧 Voda",
  electricity: "⚡ Elektřina",
  wifi: "📶 Wifi",
  shower: "🚿 Sprcha",
  toilets: "🚻 WC"
};

function photoOpts(feature: GeoFeature) {
  return {
    photo: typeof feature.properties.photo === "string" ? feature.properties.photo : null,
    wikidata: typeof feature.properties.wikidata === "string" ? feature.properties.wikidata : null
  };
}

interface Enrichment {
  address?: string | null;
  rating?: number | null;
  ratingCount?: number | null;
  photos?: string[];
  tips?: Array<{ text: string }>;
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
    window.dispatchEvent(
      new CustomEvent("mapos:fly-to", { detail: { lng: nLng, lat: nLat, zoom: 16 } })
    );
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

  const [photos, setPhotos] = useState<string[]>([]);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [enrichment, setEnrichment] = useState<Enrichment | null>(null);

  useEffect(() => {
    if (!pin) return;
    let cancelled = false;
    setPhotoIndex(0);
    setEnrichment(null);
    const initial =
      typeof pin.feature.properties.photo === "string" ? pin.feature.properties.photo : null;
    setPhotos(initial ? [initial] : []);

    const [lng, lat] = pin.feature.geometry.coordinates;
    const name = String(pin.feature.properties.name ?? "");
    const category = String(pin.feature.properties.category ?? "");
    const osmId = String(pin.feature.properties.osmId ?? pin.feature.properties.id ?? "");

    void (async () => {
      const wiki = await resolvePhotoUrl(photoOpts(pin.feature));
      if (cancelled) return;
      const base = [wiki, initial].filter(
        (u, i, arr): u is string => Boolean(u) && arr.indexOf(u) === i
      );
      setPhotos(base);
      const params = new URLSearchParams({
        lng: String(lng),
        lat: String(lat),
        name,
        category,
        osmId
      });
      try {
        const res = await fetch(`${API_BASE}/places/enrich?${params}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Enrichment;
        setEnrichment(data);
        const extra = (data.photos ?? []).filter((u) => !base.includes(u));
        setPhotos([...base, ...extra]);
      } catch {
        /* degrade to wiki/placeholder */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pin]);

  if (!pin) return null;

  const [lng, lat] = pin.feature.geometry.coordinates;
  const name = pin.feature.properties.name ?? "Pin";
  const category = String(pin.feature.properties.category ?? pin.layerId);
  const style = PIN_STYLES[category];
  const isPark4night = pin.layerId === "park4night";
  const rating =
    enrichment?.rating ??
    (typeof pin.feature.properties.rating === "number" ? pin.feature.properties.rating : null);
  const reviews =
    enrichment?.ratingCount ??
    (typeof pin.feature.properties.reviews === "number" ? pin.feature.properties.reviews : 0);
  const services = Array.isArray(pin.feature.properties.services)
    ? (pin.feature.properties.services as string[])
    : [];
  const externalUrl =
    typeof pin.feature.properties.externalUrl === "string"
      ? pin.feature.properties.externalUrl
      : null;
  const address = enrichment?.address ?? null;
  const distance = distanceMeters(view, { lng, lat });
  const gpsText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const hero = photos[photoIndex] ?? photos[0] ?? null;

  const planRoute = async (profile: "foot" | "bike" | "car" = "car") => {
    if (!("geolocation" in navigator)) {
      store.showToast("Pro trasu potřebujeme vaši polohu");
      return;
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const from = `${pos.coords.longitude},${pos.coords.latitude}`;
      const to = `${lng},${lat}`;
      try {
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
    });
  };

  const copyGps = async () => {
    try {
      await navigator.clipboard.writeText(gpsText);
      store.showToast("GPS zkopírováno");
    } catch {
      store.showToast(gpsText);
    }
  };

  const savePlace = async () => {
    const result = await saveUserPlace({ name, lng, lat, kind: "place" });
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
          {hero ? (
            <div className="pin-photo-wrap">
              <img className="pin-photo" src={hero} alt="" />
              {photos.length > 1 && (
                <div className="pin-gallery">
                  {photos.map((url, i) => (
                    <button
                      key={url}
                      type="button"
                      className={i === photoIndex ? "active" : ""}
                      onClick={() => setPhotoIndex(i)}
                    >
                      <img src={url} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="pin-photo-placeholder" aria-hidden>
              {style?.icon ?? "📍"}
            </div>
          )}

          <div className="pin-hero">
            <div className="pin-badge" style={{ background: style?.color ?? "#B7791F" }}>
              {style?.icon ?? "📍"}
            </div>
            <div>
              <h3>{name}</h3>
              <p className="meta">{style?.label ?? category}</p>
            </div>
          </div>

          <div className="gps-row">
            <span>{gpsText}</span>
            <button
              className="btn small"
              type="button"
              data-testid="copy-gps"
              onClick={() => void copyGps()}
            >
              Kopírovat
            </button>
          </div>

          {address && <p className="meta">{address}</p>}

          {(rating != null || reviews > 0) && (
            <p className="meta">
              {rating != null ? `★ ${rating.toFixed(1)}` : "★"}{" "}
              {reviews ? `(${reviews} recenzí)` : ""}
            </p>
          )}

          {enrichment?.tips?.length ? (
            <div className="discover-summary">
              {enrichment.tips.slice(0, 3).map((tip) => (
                <p key={tip.text} className="meta" style={{ marginBottom: 6 }}>
                  „{tip.text}“
                </p>
              ))}
            </div>
          ) : null}

          <p className="meta">
            Vzdálenost:{" "}
            {distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`}
          </p>

          {isPark4night && (
            <p className="meta" style={{ marginBottom: 10 }}>
              Neoficiální zdroj dat (park4night.com) — zobrazeno jako prototyp.
            </p>
          )}
          {services.length > 0 && (
            <div className="tag-grid" style={{ marginBottom: 10 }}>
              {services.map((s) => (
                <span key={s} className="tag">
                  {SERVICE_LABELS[s] ?? s}
                </span>
              ))}
            </div>
          )}
          {pin.feature.properties.description ? (
            <p>{String(pin.feature.properties.description)}</p>
          ) : null}
          <div className="actions">
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
          </div>
        </div>
      </div>
    </>
  );
}
