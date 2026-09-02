import { useEffect, useMemo, useRef, useState } from "react";
import type { SavedPlaceCollectionV2, SavedPlaceV2, TripPlan } from "@mapos/layer-sdk";
import { apiGet, apiSend } from "../lib/api";
import { emit } from "../lib/events";
import {
  loadAllSavedPlaces,
  loadSavedPlaceCollections,
  savedPlaceToFeature
} from "../lib/savedPlaces";
import { createBlankPlanDocument } from "../planning/planDraft";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { LayerTransferTools } from "./LayerTransferTools";
import { PanelShell } from "./PanelShell";
import { Icon, type IconName } from "./primitives";
import {
  filterPersonalPlaces,
  personalCategoryCounts,
  personalCategoryLabel
} from "./personalModel";

interface UserLayerSummary {
  id: string;
  name: string;
  color: string;
  isPublic: number;
  pinCount: number;
}

type MineSection = "plans" | "places" | "layers" | "games";

interface PersonalSummary {
  plans: number;
  places: number;
  layers: number;
}

function departureLabel(value: string) {
  return new Intl.DateTimeFormat("cs", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatPlanDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

export function MinePanel() {
  const store = getMapStore();
  const open = useMapStoreSnapshot((state) => state.sidebarOpen);
  const mode = useMapStoreSnapshot((state) => state.mode);
  const session = useMapStoreSnapshot((state) => state.session);
  const activePlan = useMapStoreSnapshot((state) => state.activePlan);
  const view = useMapStoreSnapshot((state) => state.view);
  const activeGames = useMapStoreSnapshot((state) => state.activeGameIds);
  const [plans, setPlans] = useState<TripPlan[]>([]);
  const [places, setPlaces] = useState<SavedPlaceV2[]>([]);
  const [collections, setCollections] = useState<SavedPlaceCollectionV2[]>([]);
  const [layers, setLayers] = useState<UserLayerSummary[]>([]);
  const [placeSearch, setPlaceSearch] = useState("");
  const [placeCategory, setPlaceCategory] = useState<string | null>(null);
  const [summary, setSummary] = useState<PersonalSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [loading, setLoading] = useState<Partial<Record<MineSection, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<MineSection, string>>>({});
  const loaded = useRef(new Set<MineSection>());
  const requestEpoch = useRef(0);

  useEffect(() => {
    requestEpoch.current += 1;
    loaded.current.clear();
    setPlans([]);
    setPlaces([]);
    setCollections([]);
    setLayers([]);
    setSummary(null);
    setErrors({});
    setLoading({});
  }, [session?.id]);

  useEffect(() => {
    if (!open || mode !== "personal" || !session) return;
    const epoch = requestEpoch.current;
    setSummaryLoading(true);
    void apiGet<PersonalSummary>("/me/personal-summary", { auth: true })
      .then((next) => {
        if (epoch === requestEpoch.current) setSummary(next);
      })
      .catch(() => {
        // Section requests still provide their own exact counts and retry state.
      })
      .finally(() => {
        if (epoch === requestEpoch.current) setSummaryLoading(false);
      });
  }, [mode, open, session]);

  const loadSection = async (section: MineSection) => {
    if (!session || loaded.current.has(section)) return;
    loaded.current.add(section);
    const epoch = requestEpoch.current;
    setLoading((current) => ({ ...current, [section]: true }));
    setErrors((current) => ({ ...current, [section]: undefined }));
    try {
      if (section === "plans") {
        const data = await apiGet<{ plans: TripPlan[] }>("/plans", { auth: true });
        if (epoch === requestEpoch.current) {
          setPlans(data.plans);
          setSummary((current) => ({
            plans: data.plans.length,
            places: current?.places ?? places.length,
            layers: current?.layers ?? layers.length
          }));
        }
      } else if (section === "places") {
        const [savedPlaces, savedCollections] = await Promise.all([
          loadAllSavedPlaces(),
          loadSavedPlaceCollections()
        ]);
        if (epoch === requestEpoch.current) {
          setPlaces(savedPlaces);
          setCollections(savedCollections);
          setSummary((current) => ({
            plans: current?.plans ?? plans.length,
            places: savedPlaces.length,
            layers: current?.layers ?? layers.length
          }));
        }
      } else if (section === "layers") {
        const data = await apiGet<{ layers: UserLayerSummary[] }>("/user-layers", {
          auth: true
        });
        if (epoch === requestEpoch.current) {
          setLayers(data.layers);
          setSummary((current) => ({
            plans: current?.plans ?? plans.length,
            places: current?.places ?? places.length,
            layers: data.layers.length
          }));
        }
      }
      // Game data is already session-scoped state, so opening that accordion makes no request.
    } catch {
      loaded.current.delete(section);
      if (epoch === requestEpoch.current) {
        setErrors((current) => ({ ...current, [section]: "Data se teď nepodařilo načíst." }));
      }
    } finally {
      if (epoch === requestEpoch.current) {
        setLoading((current) => ({ ...current, [section]: false }));
      }
    }
  };

  const categories = useMemo(() => personalCategoryCounts(places), [places]);

  const visiblePlaces = useMemo(
    () => filterPersonalPlaces(places, placeSearch, placeCategory),
    [placeCategory, placeSearch, places]
  );

  if (!open || mode !== "personal") return null;

  const openPlan = (plan: TripPlan) => {
    store.setActivePlan(plan);
    store.setMode("planning");
  };

  const startNewPlan = () => {
    store.setRoutePreview(null, false);
    store.setActivePlanDocument(createBlankPlanDocument(view.lng, view.lat));
    store.setMode("planning");
  };

  const openPlace = (savedPlace: SavedPlaceV2) => {
    const feature = savedPlaceToFeature(savedPlace);
    const [lng, lat] = feature.geometry.coordinates;
    emit("fly-to", { lng, lat, zoom: 16 });
    store.selectPin({ feature, layerId: "my-saved-places" });
  };

  const fitPlaces = (targets: readonly SavedPlaceV2[]) => {
    if (!targets.length) {
      store.showToast("Zatím nemáš žádná uložená místa");
      return;
    }
    if (targets.length === 1) {
      const [lng, lat] = targets[0]!.snapshot.position;
      emit("fly-to", { lng, lat, zoom: 16 });
      return;
    }
    const lngs = targets.map((place) => place.snapshot.position[0]);
    const lats = targets.map((place) => place.snapshot.position[1]);
    emit("fit-bounds", {
      bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
    });
  };

  const focusSavedPlaces = async () => {
    if (loaded.current.has("places")) {
      fitPlaces(places);
      return;
    }
    loaded.current.add("places");
    const epoch = requestEpoch.current;
    setLoading((current) => ({ ...current, places: true }));
    setErrors((current) => ({ ...current, places: undefined }));
    try {
      const [savedPlaces, savedCollections] = await Promise.all([
        loadAllSavedPlaces(),
        loadSavedPlaceCollections()
      ]);
      if (epoch !== requestEpoch.current) return;
      setPlaces(savedPlaces);
      setCollections(savedCollections);
      setSummary((current) => ({
        plans: current?.plans ?? plans.length,
        places: savedPlaces.length,
        layers: current?.layers ?? layers.length
      }));
      fitPlaces(savedPlaces);
    } catch {
      loaded.current.delete("places");
      if (epoch === requestEpoch.current) {
        setErrors((current) => ({ ...current, places: "Data se teď nepodařilo načíst." }));
        store.showToast("Místa se teď nepodařilo načíst");
      }
    } finally {
      if (epoch === requestEpoch.current) {
        setLoading((current) => ({ ...current, places: false }));
      }
    }
  };

  const removePlace = async (savedPlace: SavedPlaceV2) => {
    if (!window.confirm(`Odebrat „${savedPlace.snapshot.title}“ z uložených míst?`)) return;
    try {
      await apiSend("DELETE", `/v2/me/saved-places/${savedPlace.id}`);
      setPlaces((current) => current.filter((place) => place.id !== savedPlace.id));
      setSummary((current) =>
        current ? { ...current, places: Math.max(0, current.places - 1) } : current
      );
      emit("layers-changed");
      store.showToast("Místo odebráno");
    } catch {
      store.showToast("Místo se nepodařilo odebrat");
    }
  };

  const sectionCounts = {
    plans: Math.max(summary?.plans ?? 0, plans.length),
    places: Math.max(summary?.places ?? 0, places.length),
    layers: Math.max(summary?.layers ?? 0, layers.length)
  };
  const stats = [
    { value: sectionCounts.plans, label: "plánů", icon: "route" as IconName },
    { value: sectionCounts.places, label: "míst", icon: "bookmark" as IconName },
    { value: sectionCounts.layers, label: "vrstev", icon: "layers" as IconName },
    { value: activeGames.length, label: "aktivní hry" }
  ].filter(({ value }) => value > 0);

  const collectionNames = new Map(
    collections.map((collection) => [collection.id, collection.name])
  );

  return (
    <PanelShell title="Personal" testId="mine-panel" className="mine-panel">
      <div className="mine-stack">
        <section className="mine-overview" data-testid="personal-overview">
          <div className="mine-profile">
            <div className="mine-avatar">
              {session?.displayName?.slice(0, 1).toUpperCase() ?? "M"}
            </div>
            <div className="mine-profile-copy">
              <span className="mine-eyebrow">Tvůj prostor na mapě</span>
              <h3>{session?.displayName ?? "MapOS profil"}</h3>
              <p>
                {session?.isGuest
                  ? "Uloženo soukromě v tomto profilu"
                  : (session?.email ?? "Soukromý profil")}
              </p>
            </div>
            <span className="mine-account-state">
              <span aria-hidden />
              {session?.isGuest ? "Host" : "Účet"}
            </span>
            {(session?.xpTotal ?? 0) > 0 && (
              <div className="mine-rank">
                <strong>{session!.xpTotal}</strong>
                <span>XP</span>
              </div>
            )}
          </div>

          <div className="mine-hero-actions">
            <button className="btn btn-accent" type="button" onClick={startNewPlan}>
              <Icon name="plus" size={16} />
              Nový plán
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => void focusSavedPlaces()}
              disabled={summary?.places === 0 && places.length === 0}
            >
              <Icon name="crosshair" size={16} />
              Zaměřit moje místa
            </button>
          </div>

          {stats.length > 0 && (
            <div
              className="mine-stats"
              style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
              aria-label="Souhrn osobního profilu"
            >
              {stats.map((stat) => (
                <div key={stat.label}>
                  {stat.icon && <Icon name={stat.icon} size={14} />}
                  <strong>{stat.value}</strong>
                  <span>{stat.label}</span>
                </div>
              ))}
            </div>
          )}
          {summaryLoading && !summary && (
            <span className="mine-summary-loading">Načítám počty…</span>
          )}
        </section>

        <details
          className="mine-section mine-accordion"
          onToggle={(event) => event.currentTarget.open && void loadSection("plans")}
        >
          <summary>
            <span className="mine-section-icon">
              <Icon name="route" />
            </span>
            <span className="mine-section-heading">
              <strong>Uložené plány</strong>
              <span>Cesty a rozpracované itineráře</span>
            </span>
            {sectionCounts.plans > 0 && (
              <small data-testid="personal-count-plans">{sectionCounts.plans}</small>
            )}
            {loading.plans && <span className="spinner" />}
          </summary>
          <div className="mine-section-content" aria-busy={loading.plans || undefined}>
            {errors.plans && <div className="mine-inline-error">{errors.plans}</div>}
            {plans.length === 0 && activePlan && (
              <button className="mine-plan-card" type="button" onClick={() => openPlan(activePlan)}>
                <strong>{activePlan.name}</strong>
                <span>Lokální rozpracovaný plán · {activePlan.stops.length} zastávek</span>
              </button>
            )}
            {plans.map((plan) => (
              <button
                className="mine-plan-card"
                type="button"
                key={plan.id}
                onClick={() => openPlan(plan)}
              >
                <strong>{plan.name}</strong>
                <span>
                  {departureLabel(plan.departureAt)} · {plan.stops.length} zastávek ·{" "}
                  {plan.vehicle.profile}
                </span>
                <small>
                  {plan.visibility === "private"
                    ? "Soukromé"
                    : plan.visibility === "unlisted"
                      ? "Neveřejné"
                      : "Veřejné"}
                </small>
                {plan.lastResult && (
                  <small>
                    {formatPlanDuration(plan.lastResult.durationS)} · mýto{" "}
                    {plan.lastResult.tollEstimatedCzk == null
                      ? "—"
                      : `${plan.lastResult.tollEstimatedCzk} Kč`}
                  </small>
                )}
              </button>
            ))}
            {plans.length === 0 && !activePlan && !loading.plans && !errors.plans && (
              <div className="mine-empty">
                <Icon name="route" />
                <span>Zatím žádný plán.</span>
              </div>
            )}
            <button
              className="btn btn-accent block"
              type="button"
              data-testid="new-plan"
              onClick={startNewPlan}
            >
              ＋ Nový plán
            </button>
          </div>
        </details>

        <details
          className="mine-section mine-accordion"
          onToggle={(event) => event.currentTarget.open && void loadSection("places")}
          data-testid="saved-places-section"
        >
          <summary>
            <span className="mine-section-icon">
              <Icon name="bookmark" />
            </span>
            <span className="mine-section-heading">
              <strong>Moje místa</strong>
              <span>Soukromé body, kolekce a poznámky</span>
            </span>
            {sectionCounts.places > 0 && (
              <small data-testid="personal-count-places">{sectionCounts.places}</small>
            )}
            {loading.places && <span className="spinner" />}
          </summary>
          <div className="mine-section-content" aria-busy={loading.places || undefined}>
            {errors.places && <div className="mine-inline-error">{errors.places}</div>}
            {places.length > 0 && (
              <>
                <div className="mine-place-tools">
                  <input
                    type="search"
                    value={placeSearch}
                    onChange={(event) => setPlaceSearch(event.target.value)}
                    placeholder="Filtrovat uložená místa…"
                    aria-label="Filtrovat uložená místa"
                  />
                  {placeSearch && (
                    <button
                      className="btn btn-ghost mine-search-clear"
                      type="button"
                      onClick={() => setPlaceSearch("")}
                      aria-label="Vymazat filtr míst"
                    >
                      <Icon name="close" size={15} />
                    </button>
                  )}
                  <button className="btn" type="button" onClick={() => fitPlaces(places)}>
                    Ukázat všechna
                  </button>
                </div>
                <div className="mine-category-chips" aria-label="Kategorie uložených míst">
                  <button
                    className={!placeCategory ? "active" : ""}
                    type="button"
                    onClick={() => setPlaceCategory(null)}
                    aria-pressed={!placeCategory}
                  >
                    Vše {places.length}
                  </button>
                  {categories.map(({ id, label, count }) => (
                    <button
                      className={placeCategory === id ? "active" : ""}
                      type="button"
                      key={id}
                      onClick={() => setPlaceCategory(id)}
                      aria-pressed={placeCategory === id}
                    >
                      {label} {count}
                    </button>
                  ))}
                </div>
              </>
            )}
            {places.length === 0 && !loading.places && !errors.places && (
              <div className="mine-empty">
                <Icon name="bookmark" />
                <span>Zatím žádné uložené místo.</span>
              </div>
            )}
            {places.length > 0 && visiblePlaces.length === 0 && (
              <p className="meta">Tomuto filtru neodpovídá žádné místo.</p>
            )}
            {visiblePlaces.map((place) => (
              <div className="mine-saved-place" key={place.id}>
                <span className="mine-place-symbol">
                  <Icon name="pin" size={16} />
                </span>
                <button type="button" onClick={() => openPlace(place)}>
                  <strong>{place.snapshot.title}</strong>
                  <span>
                    {personalCategoryLabel(place.category)}
                    {place.collectionId && collectionNames.get(place.collectionId)
                      ? ` · ${collectionNames.get(place.collectionId)}`
                      : ""}
                  </span>
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => void removePlace(place)}
                  aria-label={`Odebrat ${place.snapshot.title}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </details>

        <details
          className="mine-section mine-accordion"
          onToggle={(event) => event.currentTarget.open && void loadSection("layers")}
          data-testid="user-layers-section"
        >
          <summary>
            <span className="mine-section-icon">
              <Icon name="layers" />
            </span>
            <span className="mine-section-heading">
              <strong>Moje vrstvy</strong>
              <span>Vlastní data, importy a publikování</span>
            </span>
            {sectionCounts.layers > 0 && (
              <small data-testid="personal-count-layers">{sectionCounts.layers}</small>
            )}
            {loading.layers && <span className="spinner" />}
          </summary>
          <div className="mine-section-content" aria-busy={loading.layers || undefined}>
            {errors.layers && <div className="mine-inline-error">{errors.layers}</div>}
            {layers.map((layer) => (
              <button
                className="mine-layer-row"
                key={layer.id}
                type="button"
                onClick={() => store.setEditMode(true, layer.id)}
              >
                <span className="mine-layer-dot" style={{ background: layer.color }} />
                <strong>{layer.name}</strong>
                <span>
                  {layer.pinCount} pinů · {layer.isPublic ? "veřejná" : "soukromá"}
                </span>
              </button>
            ))}
            {layers.length === 0 && !loading.layers && !errors.layers && (
              <div className="mine-empty">
                <Icon name="layers" />
                <span>Zatím žádná vlastní vrstva.</span>
              </div>
            )}
            <LayerTransferTools
              layers={layers}
              onImported={(layer) => {
                setLayers((current) => [
                  ...current.filter((candidate) => candidate.id !== layer.id),
                  layer
                ]);
                setSummary((current) => ({
                  plans: current?.plans ?? plans.length,
                  places: current?.places ?? places.length,
                  layers: Math.max(current?.layers ?? 0, layers.length + 1)
                }));
                emit("layers-changed");
                store.showToast("Vrstva byla importovaná");
              }}
              onRolledBack={(layerId) => {
                setLayers((current) => current.filter((layer) => layer.id !== layerId));
                setSummary((current) =>
                  current ? { ...current, layers: Math.max(0, current.layers - 1) } : current
                );
                emit("layers-changed");
                store.showToast("Import vrstvy byl vrácen zpět");
              }}
            />
            <button
              className="btn block"
              type="button"
              data-testid="manage-user-layers"
              onClick={() => store.setEditMode(true)}
            >
              Spravovat vrstvy a piny
            </button>
            <button className="btn block" type="button" onClick={() => store.openSheet("wizard")}>
              ＋ Vytvořit nebo importovat obsah
            </button>
          </div>
        </details>

        <details
          className="mine-section mine-accordion"
          onToggle={(event) => event.currentTarget.open && void loadSection("games")}
        >
          <summary>
            <span className="mine-section-icon">
              <Icon name="gamepad" />
            </span>
            <span className="mine-section-heading">
              <strong>Hra</strong>
              <span>XP a aktivní světy</span>
            </span>
            {activeGames.length > 0 && <small>{activeGames.length}</small>}
          </summary>
          <div className="mine-section-content">
            {activeGames.length === 0 && <p className="meta">Žádná hra zatím není aktivní.</p>}
            {activeGames.map((gameId) => (
              <div className="mine-game-row" key={gameId}>
                <strong>{gameId === "aavegotchi" ? "Aavegotchi" : "Trail Signals"}</strong>
                <span>{session?.xpTotal ?? 0} XP</span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </PanelShell>
  );
}
