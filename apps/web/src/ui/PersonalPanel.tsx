import { useEffect, useMemo, useRef, useState } from "react";
import {
  featureAnchor,
  planV1ToV2,
  type SavedPlaceCollectionV2,
  type SavedPlaceV2,
  type TripPlan
} from "@mapos/layer-sdk";
import { apiGet, apiSend } from "../lib/api";
import { emit } from "../lib/events";
import { t } from "../i18n/cs";
import { formatDistance } from "../lib/units";
import {
  createSavedPlaceFromFeature,
  loadAllSavedPlaces,
  loadSavedPlaceCollections,
  savedPlaceToFeature
} from "../lib/savedPlaces";
import { addPlaceToPlanDocument } from "../info/placePlanAction";
import { createBlankPlanDocument } from "../planning/planDraft";
import {
  exportPlanDocument,
  PLAN_EXPORT_LABELS,
  type PlanExportFormat
} from "../planning/planExport";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { LayerTransferTools } from "./LayerTransferTools";
import { PanelShell } from "./PanelShell";
import {
  Accordion,
  Badge,
  Button,
  Chip,
  ConfirmDialog,
  Dialog,
  EmptyState,
  IconButton,
  InlineNotice,
  ListItem,
  Menu,
  ProgressLinear,
  SearchField,
  Skeleton,
  Switch,
  TextArea,
  type AccordionSection
} from "./kit";
import {
  filterPersonalPlaces,
  personalCategoryCounts,
  personalSummaryLine,
  savedPlaceSubtitle
} from "./personalModel";
import { poiCategoryIcon } from "./layers/layerPresentation";

interface UserLayerSummary {
  id: string;
  name: string;
  color: string;
  isPublic: number;
  pinCount: number;
}

type PersonalSection = "plans" | "places" | "layers" | "games";

interface PersonalSummary {
  plans: number;
  places: number;
  layers: number;
}

/** Deletes ask first, because nothing here has an undo yet (§21.4). */
interface PersonalConfirm {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => void;
}

const GAME_NAMES: Readonly<Record<string, string>> = {
  aavegotchi: "Aavegotchi",
  "trail-signals": "Trail Signals"
};

/** XP per level. Flat rather than a curve, because the game (§24) owns the real progression and
 *  a second formula here would disagree with it the first time that one changes. */
const XP_PER_LEVEL = 100;

function planSubtitle(plan: TripPlan): string {
  const parts: string[] = [];
  if (plan.lastResult) {
    parts.push(formatDistance(plan.lastResult.distanceM, "metric"));
    parts.push(planDuration(plan.lastResult.durationS));
  }
  parts.push(
    `${plan.stops.length} ${plural(plan.stops.length, "zastávka", "zastávky", "zastávek")}`
  );
  parts.push(
    new Intl.DateTimeFormat("cs", { day: "numeric", month: "numeric" }).format(
      new Date(plan.departureAt)
    )
  );
  return parts.join(" · ");
}

function planDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  return count >= 2 && count <= 4 ? few : many;
}

/** Your plans, places, layers and ranks (§4.3).
 *
 *  Everything is behind a collapsed accordion with its count in the header, so the panel opens
 *  as a four-line table of contents instead of four lists competing for the first screen. The
 *  sections load their data the first time they are opened.
 */
export function PersonalPanel() {
  const store = getMapStore();
  const open = useMapStoreSnapshot((state) => state.sidebarOpen);
  const mode = useMapStoreSnapshot((state) => state.mode);
  const session = useMapStoreSnapshot((state) => state.session);
  const activePlan = useMapStoreSnapshot((state) => state.activePlan);
  const view = useMapStoreSnapshot((state) => state.view);
  const activeGames = useMapStoreSnapshot((state) => state.activeGameIds);
  const activeLayers = useMapStoreSnapshot((state) => state.activeLayers);

  const [plans, setPlans] = useState<TripPlan[]>([]);
  const [places, setPlaces] = useState<SavedPlaceV2[]>([]);
  const [collections, setCollections] = useState<SavedPlaceCollectionV2[]>([]);
  const [layers, setLayers] = useState<UserLayerSummary[]>([]);
  const [placeSearch, setPlaceSearch] = useState("");
  const [placeCategory, setPlaceCategory] = useState<string | null>(null);
  const [summary, setSummary] = useState<PersonalSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [loading, setLoading] = useState<Partial<Record<PersonalSection, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<PersonalSection, string>>>({});
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [exportPlan, setExportPlan] = useState<TripPlan | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ place: SavedPlaceV2; note: string } | null>(null);
  const [confirm, setConfirm] = useState<PersonalConfirm | null>(null);
  const loaded = useRef(new Set<PersonalSection>());
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
        // Each section still fetches its own exact count and owns its retry state.
      })
      .finally(() => {
        if (epoch === requestEpoch.current) setSummaryLoading(false);
      });
  }, [mode, open, session]);

  const loadSection = async (section: PersonalSection) => {
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
        const data = await apiGet<{ layers: UserLayerSummary[] }>("/user-layers", { auth: true });
        if (epoch === requestEpoch.current) {
          setLayers(data.layers);
          setSummary((current) => ({
            plans: current?.plans ?? plans.length,
            places: current?.places ?? places.length,
            layers: data.layers.length
          }));
        }
      }
      // Game progress is already session state, so opening that section makes no request.
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
  const collectionNames = useMemo(
    () => new Map(collections.map((collection) => [collection.id, collection.name])),
    [collections]
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
    const [lng, lat] = featureAnchor(feature);
    emit("fly-to", { lng, lat, zoom: 15 });
    store.selectPin({ feature, layerId: "my-saved-places" });
  };

  const removePlace = async (savedPlace: SavedPlaceV2) => {
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

  const saveMapCentre = async () => {
    const result = await createSavedPlaceFromFeature(
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [view.lng, view.lat] },
        properties: {
          id: `centre-${Date.now()}`,
          name: `Místo ${view.lat.toFixed(4)}, ${view.lng.toFixed(4)}`,
          category: "place",
          layerId: "my-saved-places"
        }
      },
      "my-saved-places"
    );
    if (result === "ok") {
      loaded.current.delete("places");
      await loadSection("places");
      setOpenSections((current) => (current.includes("places") ? current : [...current, "places"]));
      store.showToast("Střed mapy uložený do Moje místa");
      emit("layers-changed");
      return;
    }
    store.showToast(
      result === "auth"
        ? "Uložení míst vyžaduje profil"
        : result === "exists"
          ? "Tohle místo už uložené máš"
          : "Místo se nepodařilo uložit"
    );
  };

  const sectionCounts = {
    plans: Math.max(summary?.plans ?? 0, plans.length),
    places: Math.max(summary?.places ?? 0, places.length),
    layers: Math.max(summary?.layers ?? 0, layers.length),
    games: activeGames.length
  };

  const countBadge = (section: PersonalSection) =>
    sectionCounts[section] > 0 ? (
      <Badge count={sectionCounts[section]} tone="neutral" testId={`personal-count-${section}`} />
    ) : undefined;

  const sections: AccordionSection[] = [
    {
      id: "plans",
      title: "Uložené plány",
      icon: "route",
      testId: "personal-section-plans",
      action: countBadge("plans"),
      children: (
        <div className="personal-list" aria-busy={loading.plans || undefined}>
          {errors.plans && <InlineNotice tone="warning">{errors.plans}</InlineNotice>}
          {loading.plans && plans.length === 0 && <Skeleton count={3} />}
          {plans.length === 0 && activePlan && (
            <ListItem
              testId="plan-row"
              icon="route"
              title={activePlan.name}
              subtitle={`Rozpracovaný plán · ${activePlan.stops.length} ${plural(activePlan.stops.length, "zastávka", "zastávky", "zastávek")}`}
              onClick={() => openPlan(activePlan)}
            />
          )}
          {plans.map((plan) => (
            <ListItem
              key={plan.id}
              testId="plan-row"
              icon="route"
              title={plan.name}
              subtitle={planSubtitle(plan)}
              onClick={() => openPlan(plan)}
              trailing={
                <Menu
                  testId={`plan-menu-${plan.id}`}
                  trigger={
                    <IconButton icon="more_vert" label={`Možnosti plánu ${plan.name}`} size="sm" />
                  }
                  actions={[
                    {
                      id: "open",
                      label: "Otevřít",
                      icon: "open_in_new",
                      onSelect: () => openPlan(plan)
                    },
                    {
                      id: "duplicate",
                      label: "Duplikovat",
                      icon: "content_copy",
                      onSelect: () => void duplicatePlan(plan)
                    },
                    {
                      id: "export",
                      label: "Exportovat",
                      icon: "download",
                      onSelect: () => setExportPlan(plan)
                    },
                    {
                      id: "delete",
                      label: "Smazat",
                      icon: "delete",
                      destructive: true,
                      onSelect: () =>
                        setConfirm({
                          title: "Smazat plán?",
                          description: `„${plan.name}“ se smaže i se zastávkami. Vrátit to nejde.`,
                          confirmLabel: "Smazat plán",
                          run: () => void deletePlan(plan)
                        })
                    }
                  ]}
                />
              }
            />
          ))}
          {/* Empty plans show the action only: a "no plans yet" sentence above a "Nový plán"
              button says the same thing twice (§4.3). */}
          <Button variant="outlined" block testId="new-plan" icon="add" onClick={startNewPlan}>
            Nový plán
          </Button>
        </div>
      )
    },
    {
      id: "places",
      title: "Moje místa",
      icon: "bookmark",
      testId: "personal-section-places",
      action: countBadge("places"),
      children: (
        <div className="personal-list" aria-busy={loading.places || undefined}>
          {errors.places && <InlineNotice tone="warning">{errors.places}</InlineNotice>}
          {loading.places && places.length === 0 && <Skeleton count={3} />}
          {places.length > 0 && (
            <>
              <SearchField
                label="Hledat v mých místech"
                hideLabel
                placeholder="Hledat v mých místech"
                value={placeSearch}
                onChange={(event) => setPlaceSearch(event.target.value)}
                onClear={() => setPlaceSearch("")}
                testId="personal-place-search"
              />
              <div className="personal-chips" aria-label="Kategorie uložených míst">
                <Chip
                  label={`Vše ${places.length}`}
                  active={!placeCategory}
                  onClick={() => setPlaceCategory(null)}
                  testId="personal-category-all"
                />
                {categories.map(({ id, label, count }) => (
                  <Chip
                    key={id}
                    label={`${label} ${count}`}
                    active={placeCategory === id}
                    onClick={() => setPlaceCategory(placeCategory === id ? null : id)}
                    testId={`personal-category-${id}`}
                  />
                ))}
              </div>
            </>
          )}
          {places.length === 0 && !loading.places && !errors.places && (
            <EmptyState
              icon="bookmark"
              title="Ulož místo z jeho detailu."
              actionLabel="Vybrat na mapě"
              onAction={() => {
                store.setSidebarOpen(false);
                store.showToast("Klikni na místo na mapě a dej Uložit");
              }}
            />
          )}
          {places.length > 0 && visiblePlaces.length === 0 && (
            <EmptyState icon="search" title="Tomuto filtru neodpovídá žádné místo." />
          )}
          {visiblePlaces.map((place) => (
            <ListItem
              key={place.id}
              testId="saved-place-row"
              icon={poiCategoryIcon(place.category)}
              title={place.snapshot.title}
              subtitle={savedPlaceSubtitle(place, collectionNames.get(place.collectionId ?? ""))}
              onClick={() => openPlace(place)}
              trailing={
                <>
                  <IconButton
                    icon="near_me"
                    label={`Letět na ${place.snapshot.title}`}
                    size="sm"
                    onClick={() => openPlace(place)}
                  />
                  <Menu
                    testId={`saved-place-menu-${place.id}`}
                    trigger={
                      <IconButton
                        icon="more_vert"
                        label={`Možnosti místa ${place.snapshot.title}`}
                        size="sm"
                      />
                    }
                    actions={[
                      {
                        id: "to-plan",
                        label: "Přidat do plánu",
                        icon: "add_location",
                        onSelect: () => addPlaceToPlan(place)
                      },
                      {
                        id: "note",
                        label: "Upravit poznámku",
                        icon: "edit",
                        onSelect: () => setNoteDraft({ place, note: place.note ?? "" })
                      },
                      {
                        id: "remove",
                        label: "Odebrat",
                        icon: "delete",
                        destructive: true,
                        onSelect: () => void removePlace(place)
                      }
                    ]}
                  />
                </>
              }
            />
          ))}
        </div>
      )
    },
    {
      id: "layers",
      title: "Moje vrstvy",
      icon: "layers",
      testId: "personal-section-layers",
      action: countBadge("layers"),
      children: (
        <div className="personal-list" aria-busy={loading.layers || undefined}>
          {errors.layers && <InlineNotice tone="warning">{errors.layers}</InlineNotice>}
          {loading.layers && layers.length === 0 && <Skeleton count={2} />}
          {layers.map((layer) => (
            <ListItem
              key={layer.id}
              testId="user-layer-row"
              icon="layers"
              iconColor={layer.color}
              title={layer.name}
              subtitle={`${layer.pinCount} ${plural(layer.pinCount, "místo", "místa", "míst")} · ${layer.isPublic ? "veřejná" : "soukromá"}`}
              onClick={() => store.setEditMode(true, layer.id)}
              trailing={
                <>
                  <Switch
                    checked={Boolean(activeLayers[layer.id]?.visible)}
                    label={`Zobrazit ${layer.name} na mapě`}
                    testId={`user-layer-visible-${layer.id}`}
                    onChange={() => store.toggleLayer(layer.id)}
                  />
                  <Menu
                    testId={`user-layer-menu-${layer.id}`}
                    trigger={
                      <IconButton
                        icon="more_vert"
                        label={`Možnosti vrstvy ${layer.name}`}
                        size="sm"
                      />
                    }
                    actions={[
                      {
                        id: "edit",
                        label: "Upravit místa",
                        icon: "edit",
                        onSelect: () => store.setEditMode(true, layer.id)
                      },
                      {
                        id: "delete",
                        label: "Smazat",
                        icon: "delete",
                        destructive: true,
                        onSelect: () =>
                          setConfirm({
                            title: "Smazat vrstvu?",
                            description: `„${layer.name}“ se smaže i s ${layer.pinCount} ${plural(layer.pinCount, "místem", "místy", "místy")}. Vrátit to nejde.`,
                            confirmLabel: "Smazat vrstvu",
                            run: () => void deleteLayer(layer)
                          })
                      }
                    ]}
                  />
                </>
              }
            />
          ))}
          {layers.length === 0 && !loading.layers && !errors.layers && (
            <EmptyState icon="layers" title="Zatím žádná vlastní vrstva." />
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
          <Button
            variant="text"
            size="sm"
            icon="edit"
            testId="manage-user-layers"
            onClick={() => store.setEditMode(true)}
          >
            Spravovat vrstvy a piny
          </Button>
          <Button
            variant="outlined"
            block
            icon="add"
            testId="new-user-layer"
            onClick={() => store.openSheet("wizard")}
          >
            Nová vrstva
          </Button>
        </div>
      )
    },
    {
      id: "games",
      title: "Herní ranky",
      icon: "stadia_controller",
      testId: "personal-section-games",
      action: countBadge("games"),
      children: (
        <div className="personal-list">
          {activeGames.length === 0 && (
            <EmptyState
              icon="stadia_controller"
              title="Žádná hra zatím není aktivní."
              actionLabel="Otevřít Hru"
              onAction={() => store.setMode("game")}
            />
          )}
          {activeGames.map((gameId) => {
            const xp = session?.xpTotal ?? 0;
            const level = Math.floor(xp / XP_PER_LEVEL) + 1;
            return (
              <div className="personal-game" key={gameId} data-testid={`personal-game-${gameId}`}>
                <span className="personal-game-name">{GAME_NAMES[gameId] ?? gameId}</span>
                <span className="personal-game-xp">
                  Lvl {level} · {xp} XP
                </span>
                <ProgressLinear
                  value={(xp % XP_PER_LEVEL) / XP_PER_LEVEL}
                  label={`Postup na úroveň ${level + 1}`}
                />
              </div>
            );
          })}
        </div>
      )
    }
  ];

  function addPlaceToPlan(place: SavedPlaceV2) {
    const document = store.activePlanDocument;
    if (!document) {
      store.setMode("planning");
      store.showToast("Nejdřív vytvoř plán; místo pak přidej znovu");
      return;
    }
    const [lng, lat] = place.snapshot.position;
    try {
      store.setActivePlanDocument(
        addPlaceToPlanDocument(
          document,
          { id: place.id, name: place.snapshot.title, lng, lat },
          (prefix) => `${prefix}-${place.id}-${document.stops.length}`
        )
      );
      store.showToast(`${place.snapshot.title} přidáno do plánu`);
    } catch {
      store.showToast("Interaktivní plán už má maximum zastávek");
    }
  }

  async function duplicatePlan(plan: TripPlan) {
    try {
      const created = await apiSend<{ plan: TripPlan }>("POST", "/plans", {
        ...plan,
        id: undefined,
        name: `${plan.name} (kopie)`
      });
      setPlans((current) => [created.plan, ...current]);
      store.showToast("Plán duplikovaný");
    } catch {
      store.showToast("Plán se nepodařilo duplikovat");
    }
  }

  async function deletePlan(plan: TripPlan) {
    try {
      await apiSend("DELETE", `/plans/${plan.id}`);
      setPlans((current) => current.filter((item) => item.id !== plan.id));
      setSummary((current) =>
        current ? { ...current, plans: Math.max(0, current.plans - 1) } : current
      );
      store.showToast("Plán smazaný");
    } catch {
      store.showToast("Plán se nepodařilo smazat");
    }
  }

  async function saveNote(place: SavedPlaceV2, note: string) {
    const trimmed = note.trim();
    try {
      const updated = await apiSend<{ savedPlace: SavedPlaceV2 }>(
        "PATCH",
        `/v2/me/saved-places/${place.id}`,
        { note: trimmed.length ? trimmed : null }
      );
      setPlaces((current) =>
        current.map((candidate) => (candidate.id === place.id ? updated.savedPlace : candidate))
      );
      setNoteDraft(null);
      store.showToast("Poznámka uložená");
    } catch {
      store.showToast("Poznámku se nepodařilo uložit");
    }
  }

  async function runPlanExport(plan: TripPlan, format: PlanExportFormat) {
    try {
      await exportPlanDocument(planV1ToV2(plan), format);
      setExportPlan(null);
    } catch {
      store.showToast("Plán se nepodařilo exportovat");
    }
  }

  async function deleteLayer(layer: UserLayerSummary) {
    try {
      await apiSend("DELETE", `/user-layers/${layer.id}`);
      setLayers((current) => current.filter((item) => item.id !== layer.id));
      setSummary((current) =>
        current ? { ...current, layers: Math.max(0, current.layers - 1) } : current
      );
      emit("layers-changed");
      store.showToast("Vrstva smazaná");
    } catch {
      store.showToast("Vrstvu se nepodařilo smazat");
    }
  }

  return (
    <PanelShell
      title={t("mode.personal")}
      testId="personal-panel"
      className="personal-panel"
      headerExtra={
        <Menu
          testId="personal-add"
          trigger={<IconButton icon="add" label="Přidat" size="sm" />}
          actions={[
            { id: "plan", label: "Nový plán", icon: "route", onSelect: startNewPlan },
            {
              id: "layer",
              label: "Nová vrstva",
              icon: "layers",
              onSelect: () => store.openSheet("wizard")
            },
            {
              id: "place",
              label: "Uložit střed mapy",
              icon: "bookmark",
              onSelect: () => void saveMapCentre()
            }
          ]}
        />
      }
    >
      <div className="personal-stack">
        <section className="personal-profile" data-testid="personal-overview">
          <span className="personal-avatar" aria-hidden>
            {(session?.displayName ?? "M").slice(0, 1).toLocaleUpperCase("cs")}
          </span>
          <span className="personal-profile-copy">
            <span className="personal-name">{session?.displayName ?? t("personal.guest")}</span>
            <span className="personal-summary" data-testid="personal-summary">
              {personalSummaryLine({ ...sectionCounts, games: activeGames.length })}
            </span>
          </span>
          {summaryLoading && !summary && <Skeleton count={1} height={16} />}
        </section>

        {session?.isGuest && (
          <div className="personal-guest">
            <Button variant="outlined" size="sm" onClick={() => store.openSheet("auth")}>
              {t("personal.signIn")}
            </Button>
            <Button
              variant="text"
              size="sm"
              icon="account_balance_wallet"
              onClick={() => store.showToast("Peněženku připravujeme")}
            >
              Připojit peněženku
            </Button>
          </div>
        )}

        <Accordion
          sections={sections}
          value={openSections}
          onValueChange={(next) => {
            setOpenSections(next);
            for (const id of next) {
              if (!openSections.includes(id)) void loadSection(id as PersonalSection);
            }
          }}
          testId="personal-accordion"
        />
      </div>

      <Dialog
        open={exportPlan !== null}
        onOpenChange={(next) => !next && setExportPlan(null)}
        title="Exportovat plán"
        description={exportPlan?.name}
        size="sm"
        testId="plan-export-dialog"
      >
        <div className="personal-export-formats">
          {(Object.keys(PLAN_EXPORT_LABELS) as PlanExportFormat[]).map((format) => (
            <Button
              key={format}
              variant="outlined"
              block
              icon="download"
              testId={`export-${format}`}
              onClick={() => exportPlan && void runPlanExport(exportPlan, format)}
            >
              {PLAN_EXPORT_LABELS[format]}
            </Button>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={noteDraft !== null}
        onOpenChange={(next) => !next && setNoteDraft(null)}
        title="Poznámka k místu"
        description={noteDraft?.place.snapshot.title}
        size="sm"
        testId="place-note-dialog"
        footer={
          <>
            <Button variant="text" onClick={() => setNoteDraft(null)}>
              Zrušit
            </Button>
            <Button
              testId="place-note-save"
              onClick={() => noteDraft && void saveNote(noteDraft.place, noteDraft.note)}
            >
              Uložit
            </Button>
          </>
        }
      >
        <TextArea
          label="Poznámka"
          hideLabel
          rows={4}
          placeholder="Co si o místě chceš pamatovat"
          value={noteDraft?.note ?? ""}
          onChange={(event) =>
            setNoteDraft((current) =>
              current ? { ...current, note: event.target.value } : current
            )
          }
          testId="place-note-input"
        />
      </Dialog>

      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setConfirm(null)}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel}
          destructive
          onConfirm={confirm.run}
        />
      )}
    </PanelShell>
  );
}
