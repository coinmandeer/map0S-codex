import { useEffect, useMemo, useState } from "react";
import type { GeoFeature } from "@mapos/layer-sdk";
import { distanceMeters } from "@mapos/layer-sdk";
import { getMapStore } from "../store/mapStore";
import { emit } from "../lib/events";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { PIN_STYLES, type PinStyle } from "./presets";
import { preloadPlacePhotos, resolvePhotoUrl } from "./photoCache";
import { PanelShell } from "./PanelShell";
import { SourceStatus } from "./SourceStatus";

function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function PlacePhoto({ feature, style }: { feature: GeoFeature; style?: PinStyle }) {
  const directPhoto =
    typeof feature.properties.photo === "string" ? (feature.properties.photo as string) : null;
  const wikidata =
    typeof feature.properties.wikidata === "string"
      ? (feature.properties.wikidata as string)
      : null;
  const [resolved, setResolved] = useState<string | null>(directPhoto);

  useEffect(() => {
    setResolved(directPhoto);
    let cancelled = false;
    void resolvePhotoUrl({ photo: directPhoto, wikidata }).then((url) => {
      if (!cancelled) setResolved(url);
    });
    return () => {
      cancelled = true;
    };
  }, [wikidata, directPhoto]);

  if (resolved) {
    return <img className="place-card-photo" src={resolved} loading="lazy" alt="" />;
  }
  return (
    <div
      className="place-card-photo place-card-photo-fallback"
      style={{ background: style?.color ?? "#B7791F" }}
    >
      {style?.icon ?? "📍"}
    </div>
  );
}

function PlacesTab() {
  const store = getMapStore();
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  const visibleFeatures = useMapStoreSnapshot((s) => s.visibleFeatures);
  const loadingLayers = useMapStoreSnapshot((s) => s.loadingLayers);
  const view = useMapStoreSnapshot((s) => s.view);
  const searchPending = useMapStoreSnapshot((s) => s.searchHerePending);

  const places = useMemo(() => {
    const all: { feature: GeoFeature; layerId: string; distance: number }[] = [];
    for (const [layerId, state] of Object.entries(active)) {
      if (!state.visible) continue;
      for (const feature of visibleFeatures[layerId] ?? []) {
        const [lng, lat] = feature.geometry.coordinates;
        all.push({ feature, layerId, distance: distanceMeters(view, { lng, lat }) });
      }
    }
    return all.sort((a, b) => a.distance - b.distance).slice(0, 60);
  }, [active, visibleFeatures, view]);

  useEffect(() => {
    preloadPlacePhotos(
      places.slice(0, 20).map((p) => ({
        photo: typeof p.feature.properties.photo === "string" ? p.feature.properties.photo : null,
        wikidata:
          typeof p.feature.properties.wikidata === "string" ? p.feature.properties.wikidata : null
      }))
    );
  }, [places]);

  const isLoading = Object.keys(loadingLayers).length > 0;
  const hasActiveLayers = Object.values(active).some((s) => s.visible);

  const openPlace = (p: { feature: GeoFeature; layerId: string }) => {
    const [lng, lat] = p.feature.geometry.coordinates;
    emit("fly-to", { lng, lat, zoom: 16 });
    store.selectPin({ feature: p.feature, layerId: p.layerId });
    if (window.innerWidth < 900) store.setSidebarOpen(false);
  };

  if (!hasActiveLayers) {
    return (
      <div className="places-empty">
        <p>Zapni vrstvu přes ikonu vrstev v horní liště.</p>
      </div>
    );
  }

  if (!places.length) {
    return (
      <div className="places-empty">
        {isLoading ? (
          <>
            {[0, 1, 2].map((i) => (
              <div key={i} className="place-card skeleton" />
            ))}
          </>
        ) : searchPending ? (
          <>
            <p>Posunul jsi mapu. Načti místa v tomto výřezu.</p>
            <button
              className="btn btn-accent"
              onClick={() => {
                store.setSearchHerePending(false);
                emit("search-here");
              }}
            >
              Hledat v této oblasti
            </button>
          </>
        ) : (
          <p>
            V tomto výřezu nic není. Zkus usecase Gastro / Město, nebo přibliž mapu a klepni Hledat
            zde.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="places-list" data-testid="places-list">
      {places.map((p) => {
        const category = String(p.feature.properties.category ?? p.layerId);
        const style = PIN_STYLES[category];
        const tags = Array.isArray(p.feature.properties.tags)
          ? (p.feature.properties.tags as string[])
          : [];
        return (
          <button
            key={`${p.layerId}-${p.feature.properties.id}`}
            className="place-card"
            onClick={() => openPlace(p)}
          >
            <PlacePhoto feature={p.feature} style={style} />
            <div className="place-card-body">
              <h4>{p.feature.properties.name ?? "Bez názvu"}</h4>
              <p className="meta">
                {style?.label ?? category} · {formatDistance(p.distance)}
              </p>
              {tags.length > 0 && (
                <div className="tag-row">
                  {tags.slice(0, 3).map((t) => (
                    <span key={t} className="tag-chip">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function PlacesPanel() {
  const open = useMapStoreSnapshot((s) => s.sidebarOpen);
  const mode = useMapStoreSnapshot((s) => s.mode);

  if (!open || mode === "discover") return null;

  return (
    <PanelShell
      title="Místa v okolí"
      testId="places-panel"
      headerExtra={<SourceStatus testId="panel-source-strip" />}
    >
      <PlacesTab />
    </PanelShell>
  );
}
