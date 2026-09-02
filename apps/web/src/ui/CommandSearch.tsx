import { useEffect, useMemo, useRef, useState } from "react";
import { createAdjacentPlanSegments, planRoutePolicyHash } from "@mapos/layer-sdk";
import type { AppModeInput } from "../product/registry";
import {
  buildEmptySuggestions,
  createRecentSearchRepository,
  isValidCoordinates,
  LatestRequestRunner,
  resolveLocationIntent,
  type EmptySuggestionAction,
  type LocationIntent,
  type RecentSearchKind
} from "../search";
import { getMapStore } from "../store/mapStore";
import { getShellStore } from "../store/shellStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { API_BASE } from "../lib/api";
import { apiPost } from "../lib/api";
import { emit } from "../lib/events";
import { geolocation, type Fix } from "../lib/geolocation";
import { formatDistance } from "../lib/units";
import { createBlankPlanDocument } from "../planning/planDraft";
import { LAYER_MODES } from "./modes";
import { Icon } from "./primitives";

interface GeoHit {
  display_name: string;
  lat: string;
  lon: string;
  type?: string;
  hierarchy?: string[];
  source?: { id?: string; label?: string };
  confidence?: {
    level?: "high" | "medium" | "low";
    label?: string;
    basis?: "provider-order";
  };
}

interface TagHit {
  tag: string;
  count: number;
}

interface SearchResponse {
  hits: GeoHit[];
  tagHits: TagHit[];
}

interface AiSearchResult {
  id: string;
  layerId: string;
  title: string;
  longitude: number;
  latitude: number;
  distanceMeters: number;
  source: { sourceId: string; label: string; url?: string };
}

interface AiSearchAnswer {
  status: "succeeded";
  conversation: { id: string; revision: number; scope: { type: "global" } };
  answer: { text: string; results: AiSearchResult[] };
}

function geocodeTypeLabel(value: string | undefined): string {
  const normalized = value?.toLocaleLowerCase("cs-CZ") ?? "";
  if (["house", "building", "address", "residential"].includes(normalized)) return "Adresa";
  if (["city", "town", "village", "municipality", "locality"].includes(normalized)) return "Obec";
  if (["state", "region", "county", "administrative", "regional"].includes(normalized))
    return "Region";
  if (["suburb", "neighbourhood", "city_district"].includes(normalized)) return "Část města";
  if (["poi", "amenity", "tourism", "shop", "leisure"].includes(normalized)) return "Místo / POI";
  return value?.trim() || "Místo";
}

function geocodeHierarchy(hit: GeoHit): string {
  if (Array.isArray(hit.hierarchy) && hit.hierarchy.length) return hit.hierarchy.join(" › ");
  return hit.display_name
    .split(",")
    .slice(1, 5)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" › ");
}

function validGeoHit(hit: GeoHit): boolean {
  return (
    typeof hit.display_name === "string" &&
    hit.display_name.trim().length > 0 &&
    isValidCoordinates({ lat: Number(hit.lat), lng: Number(hit.lon) })
  );
}

function intentLabel(intent: LocationIntent): string | null {
  if (intent.kind === "coordinates") return "Souřadnice · přesunout mapu";
  if (intent.kind === "map-share")
    return `Sdílená mapa (${intent.location.provider}) · přesunout mapu`;
  if (intent.kind === "category") return `Kategorie #${intent.tag} · zapnout filtr`;
  if (intent.kind === "address") return "Adresa · hledat místo";
  if (intent.kind === "locality") return "Město nebo region · hledat místo";
  if (intent.kind === "poi") return "POI dotaz · hledat v mapě";
  if (intent.kind === "place") return "Místo · hledat v mapě";
  if (intent.kind === "ai") return "AI konverzace · bez automatické změny mapy";
  if (intent.kind === "invalid") return "Tento vstup nelze bezpečně otevřít";
  return null;
}

function recentKind(intent: LocationIntent): RecentSearchKind {
  return intent.kind === "address" ||
    intent.kind === "locality" ||
    intent.kind === "poi" ||
    intent.kind === "place" ||
    intent.kind === "category" ||
    intent.kind === "coordinates" ||
    intent.kind === "map-share" ||
    intent.kind === "ai"
    ? intent.kind
    : "place";
}

export function CommandSearch({
  onFlyToMe,
  mode
}: {
  onFlyToMe: () => Promise<Fix | null>;
  mode: "personal" | "discover" | "planning" | "game";
}) {
  const store = getMapStore();
  const shell = getShellStore();
  const activeTag = useMapStoreSnapshot((state) => state.activeTag);
  const activeLayers = useMapStoreSnapshot((state) => state.activeLayers);
  const view = useMapStoreSnapshot((state) => state.view);
  const capabilities = useMapStoreSnapshot((state) => state.capabilities);
  const aiEnabled = useMapStoreSnapshot((state) => state.preferences.aiEnabled);
  const units = useMapStoreSnapshot((state) => state.preferences.units);
  const requestRunner = useRef(new LatestRequestRunner<SearchResponse>());
  const repository = useMemo(
    () =>
      typeof window === "undefined" ? null : createRecentSearchRepository(window.localStorage),
    []
  );

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeoHit[]>([]);
  const [tagHits, setTagHits] = useState<TagHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchSettled, setSearchSettled] = useState(false);
  const [focused, setFocused] = useState(false);
  const [, setRecentRevision] = useState(0);
  const [aiPreviewOpen, setAiPreviewOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNeedsLayer, setAiNeedsLayer] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<AiSearchAnswer | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSelection, setAiSelection] = useState<AiSearchResult | null>(null);
  const [aiPlanPreviewed, setAiPlanPreviewed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [permission, setPermission] = useState<PermissionState | "unknown">("unknown");

  const intent = useMemo(
    () =>
      resolveLocationIntent(query, {
        maposOrigins: typeof window === "undefined" ? [] : [window.location.origin]
      }),
    [query]
  );
  const emptySections = buildEmptySuggestions({
    recent: repository?.list() ?? [],
    quickActions: ["map-picker", "saved-places", "new-plan"],
    modes: LAYER_MODES.map((item) => ({
      id: item.id,
      label: item.label,
      mode: item.id
    }))
  });

  useEffect(() => {
    let cancelled = false;
    void geolocation.permission().then((state) => {
      if (!cancelled) setPermission(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const runner = requestRunner.current;
    // React StrictMode immediately runs one development cleanup before the stable mount.
    // A permanent dispose here made every later global-search request fail before fetch.
    return () => {
      runner.cancel("component-unmounted");
    };
  }, []);

  useEffect(() => {
    const runner = requestRunner.current;
    setAiPreviewOpen(false);
    setAiNeedsLayer(false);
    setAiAnswer(null);
    setAiError(null);
    setAiSelection(null);
    setAiPlanPreviewed(false);
    setSearchSettled(false);
    const networkIntent =
      intent.kind === "address" ||
      intent.kind === "locality" ||
      intent.kind === "poi" ||
      intent.kind === "place" ||
      intent.kind === "category";
    if (!networkIntent || intent.query.length < 2) {
      runner.cancel("intent-changed");
      setSearching(false);
      setHits([]);
      setTagHits([]);
      return;
    }

    let mounted = true;
    const delay = intent.kind === "category" ? 200 : 280;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void runner
        .run(
          async (signal) => {
            if (intent.kind === "category") {
              const response = await fetch(
                `${API_BASE}/tags/top?q=${encodeURIComponent(intent.tag)}`,
                { signal }
              );
              if (!response.ok) return { hits: [], tagHits: [] };
              const data = (await response.json()) as { tags?: TagHit[] };
              return {
                hits: [],
                tagHits: (data.tags ?? []).filter(
                  (item) =>
                    typeof item.tag === "string" &&
                    item.tag.length <= 64 &&
                    Number.isFinite(item.count)
                )
              };
            }
            const response = await fetch(
              `${API_BASE}/geocode?q=${encodeURIComponent(intent.query)}&provider=auto`,
              { signal }
            );
            if (!response.ok) return { hits: [], tagHits: [] };
            const data = (await response.json()) as { results?: GeoHit[] };
            return { hits: (data.results ?? []).filter(validGeoHit), tagHits: [] };
          },
          ({ hits: nextHits, tagHits: nextTagHits }) => {
            setHits(nextHits);
            setTagHits(nextTagHits);
          }
        )
        .catch(() => {
          if (mounted) {
            setHits([]);
            setTagHits([]);
          }
        })
        .finally(() => {
          if (mounted) {
            setSearching(false);
            setSearchSettled(true);
          }
        });
    }, delay);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
      runner.cancel("query-changed");
    };
  }, [intent]);

  const clearResults = () => {
    setQuery("");
    setHits([]);
    setTagHits([]);
    setAiPreviewOpen(false);
    setSearchSettled(false);
  };

  const remember = (label: string, selectedIntent: LocationIntent) => {
    if (!repository || selectedIntent.kind === "empty" || selectedIntent.kind === "invalid") return;
    repository.add({
      query: selectedIntent.input.trim(),
      label,
      kind: recentKind(selectedIntent),
      ...(selectedIntent.kind === "coordinates"
        ? { coordinates: selectedIntent.coordinates }
        : selectedIntent.kind === "map-share"
          ? { coordinates: selectedIntent.location }
          : {})
    });
    setRecentRevision((value) => value + 1);
  };

  const flyTo = (
    location: { lng: number; lat: number; zoom?: number },
    label: string,
    selectedIntent?: LocationIntent
  ) => {
    const zoom = location.zoom ?? 14;
    emit("fly-to", { lng: location.lng, lat: location.lat, zoom });
    store.setView({ lng: location.lng, lat: location.lat, zoom });
    if (selectedIntent) remember(label, selectedIntent);
    clearResults();
    setFocused(false);
    emit("search-here");
  };

  const pickHit = (hit: GeoHit) => {
    flyTo(
      { lng: Number(hit.lon), lat: Number(hit.lat) },
      hit.display_name,
      intent.kind === "empty" || intent.kind === "invalid" ? undefined : intent
    );
  };

  const pickTag = (tag: string) => {
    store.setActiveTag(tag);
    if (intent.kind === "category") remember(`#${tag}`, intent);
    clearResults();
    setFocused(false);
    store.showToast(`Filtr #${tag}`);
  };

  const executeIntent = () => {
    if (intent.kind === "coordinates") {
      flyTo(intent.coordinates, intent.coordinates.normalized, intent);
    } else if (intent.kind === "map-share") {
      flyTo(intent.location, `Sdílené místo (${intent.location.provider})`, intent);
    } else if (intent.kind === "category") {
      pickTag(intent.tag);
    } else if (intent.kind === "ai" && aiEnabled) {
      setAiPreviewOpen(true);
    } else if (hits[0]) {
      pickHit(hits[0]);
    }
  };

  const requestAiSearch = async (prompt: string) => {
    if (aiBusy || !aiEnabled) return;
    setAiBusy(true);
    setAiNeedsLayer(false);
    setAiError(null);
    setAiAnswer(null);
    setAiSelection(null);
    setAiPlanPreviewed(false);
    try {
      const response = await apiPost<AiSearchAnswer>("/v2/ai/orchestrate", {
        prompt,
        conversation: { mode: "new", scope: { type: "global" } },
        reference: { source: "map-center", longitude: view.lng, latitude: view.lat },
        activeLayerIds: ["osm-poi"],
        activeFilters: {},
        radiusMeters: 10_000,
        limit: 4,
        preciseLocationConsent: false
      });
      setAiAnswer(response);
    } catch (cause) {
      setAiError(
        cause instanceof Error
          ? cause.message
          : "AI hledání se nepodařilo dokončit. Běžné výsledky zůstávají dostupné."
      );
    } finally {
      setAiBusy(false);
    }
  };

  const confirmAiSearch = () => {
    const prompt = intent.kind === "ai" ? intent.query : query.trim();
    if (!prompt) return;
    if (!activeLayers["osm-poi"]?.visible) {
      setAiNeedsLayer(true);
      return;
    }
    void requestAiSearch(prompt);
  };

  const activatePoiAndSearch = () => {
    if (!store.activeLayers["osm-poi"]?.visible) store.toggleLayer("osm-poi");
    const prompt = intent.kind === "ai" ? intent.query : query.trim();
    if (prompt) void requestAiSearch(prompt);
  };

  const openAiCandidate = (result: AiSearchResult) => {
    shell.startMapPicker(
      {
        caller: {
          id: `command-search-ai-${result.id}`,
          label: "Potvrď AI návrh místa",
          context: result.title
        },
        cancelPolicy: "restore-original-view",
        originalView: { center: { lng: view.lng, lat: view.lat }, zoom: view.zoom },
        candidate: { lng: result.longitude, lat: result.latitude, label: result.title }
      },
      (pickerResult) => {
        if (pickerResult.status !== "confirmed") return;
        setAiSelection(result);
        store.showToast(`„${result.title}“ bylo vráceno do AI konverzace`);
      }
    );
    emit("fly-to", {
      lng: result.longitude,
      lat: result.latitude,
      zoom: Math.max(view.zoom, 14)
    });
  };

  const previewAiPlan = () => {
    const results = aiAnswer?.answer.results ?? [];
    if (!results.length) return;
    store.setRoutePreview(
      {
        coordinates: [],
        distanceM: 0,
        durationS: 0,
        profile: "foot",
        stops: results.map((result, index) => ({
          coordinates: [result.longitude, result.latitude],
          order: index + 1,
          name: result.title
        }))
      },
      false
    );
    setAiPlanPreviewed(true);
    store.showToast("Návrhy jsou jako pracovní body nad současnou mapou");
  };

  const createPlanFromAi = () => {
    const response = aiAnswer;
    const results = response?.answer.results ?? [];
    if (!response || !results.length) return;
    const base = createBlankPlanDocument(view.lng, view.lat);
    const routePolicy = {
      ...base.routePolicy,
      profile: "foot" as const,
      preference: "fast" as const
    };
    const stops = [
      {
        ...base.stops[0]!,
        name: "Začátek podle středu mapy",
        location: { type: "Point" as const, coordinates: [view.lng, view.lat] as [number, number] },
        status: "accepted" as const
      },
      ...results.map((result, index) => ({
        id: `ai-stop-${index + 1}-${result.id.slice(-32)}`,
        order: index + 1,
        name: result.title,
        location: {
          type: "Point" as const,
          coordinates: [result.longitude, result.latitude] as [number, number]
        },
        sourceFeatureId: result.id,
        dwellMinutes: 0,
        notes: `${formatDistance(result.distanceMeters, units)} · ${result.source.label}`,
        conversationId: response.conversation.id,
        status: "suggested" as const
      }))
    ];
    const plan = {
      ...base,
      revision: base.revision + 1,
      name: `AI návrh: ${(intent.kind === "ai" ? intent.query : query).trim().slice(0, 80)}`,
      routePolicy,
      stops,
      segments: createAdjacentPlanSegments(stops, planRoutePolicyHash(routePolicy, base.vehicle)),
      conversationIds: [response.conversation.id],
      activatedLayerIds: ["osm-poi"],
      metadata: { ...base.metadata, "dev.mapos.aiSuggested": true }
    };
    store.setActivePlanDocument(plan);
    store.setRoutePreview(
      {
        coordinates: [],
        distanceM: 0,
        durationS: 0,
        profile: "foot",
        stops: stops.map((stop) => ({
          coordinates: [...stop.location.coordinates] as [number, number],
          order: stop.order + 1,
          name: stop.name
        }))
      },
      false
    );
    shell.setMode("planning");
    setFocused(false);
    store.showToast("AI návrhy byly převedeny do editovatelného plánu k potvrzení");
  };

  const flyToMe = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const fix = await onFlyToMe();
      if (!fix || mode !== "discover") return;
      const response = await fetch(`${API_BASE}/geocode/reverse?lat=${fix.lat}&lng=${fix.lng}`);
      if (!response.ok) return;
      const data = (await response.json()) as { country?: string } | null;
      if (data?.country) store.setCountry(data.country);
    } catch {
      // onFlyToMe already reports location errors; country enrichment is optional.
    } finally {
      setLocating(false);
      setPermission(await geolocation.permission());
    }
  };

  const runEmptyAction = (action: EmptySuggestionAction) => {
    if (action.type === "search") {
      setQuery(action.query);
      return;
    }
    if (action.type === "locate-current") {
      void flyToMe();
      return;
    }
    if (action.type === "go-to-location") {
      flyTo(action.coordinates, "Poslední poloha");
      return;
    }
    if (action.type === "open-map-picker") {
      shell.startMapPicker(
        {
          caller: { id: "command-search", label: "Vyber místo pro hledání" },
          cancelPolicy: "restore-original-view",
          originalView: { center: { lng: view.lng, lat: view.lat }, zoom: view.zoom },
          candidate: { lng: view.lng, lat: view.lat }
        },
        (result) => {
          if (result.status === "confirmed") flyTo(result.location, "Místo vybrané na mapě");
        }
      );
      setFocused(false);
      return;
    }
    if (action.type === "open-saved-places") {
      shell.setMode("personal");
      shell.openLeftContext({ type: "mode", mode: "personal" });
      setFocused(false);
      return;
    }
    if (action.type === "new-plan") {
      shell.setMode("planning");
      shell.openLeftContext({ type: "mode", mode: "planning" });
      store.showToast("Nový plán můžeš sestavit v panelu Plánování");
      setFocused(false);
      return;
    }
    shell.setMode(action.mode as AppModeInput);
    setFocused(false);
  };

  const label = intentLabel(intent);
  const locationState = locating ? "locating" : permission === "denied" ? "denied" : "idle";
  const showMenu = focused && (intent.kind === "empty" || label !== null || searching);
  const networkIntent =
    intent.kind === "address" ||
    intent.kind === "locality" ||
    intent.kind === "poi" ||
    intent.kind === "place" ||
    intent.kind === "category";

  return (
    <div
      className="topbar-search"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <Icon name="search" size={16} />
      <input
        data-testid="place-search"
        aria-label="Hledat místo, souřadnice, odkaz, tag nebo použít AI"
        placeholder="Místo, GPS, odkaz, #tag nebo AI…"
        value={query}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showMenu}
        aria-controls="command-search-suggestions"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setFocused(false);
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            executeIntent();
          }
        }}
      />
      {searching && <span className="spinner" aria-label="Hledám" />}
      {activeTag && (
        <button className="tag-chip" onClick={() => store.setActiveTag(null)} type="button">
          #{activeTag} ✕
        </button>
      )}
      <button
        type="button"
        className="search-locate-btn"
        data-testid="location-btn"
        data-state={locationState}
        title={locationState === "denied" ? "Poloha je zakázaná v prohlížeči" : "Moje poloha"}
        aria-label="Moje poloha"
        aria-busy={locating}
        disabled={locating}
        onClick={() => void flyToMe()}
      >
        {locating ? <span className="spinner" /> : <Icon name="crosshair" size={16} />}
        <span className="search-locate-label">Moje poloha</span>
      </button>

      {showMenu && (
        <div
          className="search-hits command-search-menu"
          id="command-search-suggestions"
          role="dialog"
          aria-label="Návrhy hledání"
        >
          {intent.kind === "empty" ? (
            emptySections.map((section) => (
              <section className="command-search-section" key={section.id}>
                <div className="command-search-section-title">
                  <span>{section.label}</span>
                  {section.id === "recent" && (
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => {
                        repository?.clear();
                        setRecentRevision((value) => value + 1);
                      }}
                    >
                      Vymazat
                    </button>
                  )}
                </div>
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="search-hit"
                    onClick={() => runEmptyAction(item.action)}
                  >
                    <span>{item.label}</span>
                    {item.description && <span className="meta">{item.description}</span>}
                  </button>
                ))}
              </section>
            ))
          ) : (
            <>
              {label && (
                <button
                  type="button"
                  className="search-hit command-search-intent"
                  disabled={
                    intent.kind === "invalid" ||
                    networkIntent ||
                    (intent.kind === "ai" && !aiEnabled)
                  }
                  onClick={executeIntent}
                >
                  <strong>{label}</strong>
                  {intent.kind === "coordinates" && (
                    <span className="meta">{intent.coordinates.normalized}</span>
                  )}
                  {intent.kind === "ai" && (
                    <span className="meta">
                      {aiEnabled
                        ? "Nejprve se otevře náhled"
                        : "AI funkce jsou vypnuté v Nastavení"}
                    </span>
                  )}
                </button>
              )}
              {networkIntent && intent.kind !== "category" && aiEnabled && (
                <section className="command-search-choice" aria-label="Způsob hledání">
                  <div>
                    <strong>Běžné hledání</strong>
                    <span>Rychlé výsledky geokodéru jsou zobrazené níže.</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost small"
                    data-testid="search-offer-ai"
                    onClick={() => setAiPreviewOpen(true)}
                  >
                    Zeptat se AI
                  </button>
                </section>
              )}
              {intent.kind === "ai" && aiPreviewOpen && <></>}
              {aiPreviewOpen && aiEnabled && (
                <div className="command-search-ai-preview" role="status">
                  <div className="command-search-ai-head">
                    <strong>AI použije střed mapy a aktivní vrstvy</strong>
                    <span>
                      Požadavek se odešle až tlačítkem. Výsledek nejprve uvidíš jako návrh.
                    </span>
                  </div>
                  {!aiAnswer && !aiNeedsLayer && (
                    <button
                      type="button"
                      className="btn btn-accent small"
                      data-testid="search-run-ai"
                      disabled={aiBusy}
                      onClick={confirmAiSearch}
                    >
                      {aiBusy ? "AI hledá…" : "Spustit AI hledání"}
                    </button>
                  )}
                  {capabilities?.cml === false && (
                    <span>
                      Mapový AI nástroj funguje deterministicky i bez generativního modelu.
                    </span>
                  )}
                  {aiNeedsLayer && (
                    <div
                      className="command-search-ai-command"
                      data-testid="search-ai-layer-preview"
                    >
                      <div>
                        <strong>Návrh změny: zapnout POI vrstvy</strong>
                        <span>
                          AI potřebuje veřejná místa v aktuálním výřezu. Nic se nezapne samo.
                        </span>
                      </div>
                      <button type="button" className="btn small" onClick={activatePoiAndSearch}>
                        Potvrdit a pokračovat
                      </button>
                    </div>
                  )}
                  {aiError && <span className="command-search-ai-error">{aiError}</span>}
                  {aiAnswer && (
                    <div className="command-search-ai-answer" data-testid="search-ai-results">
                      <strong>AI odpověď</strong>
                      <span>{aiAnswer.answer.text}</span>
                      {aiAnswer.answer.results.map((result) => (
                        <button
                          type="button"
                          className="command-search-ai-result"
                          key={result.id}
                          onClick={() => openAiCandidate(result)}
                        >
                          <strong>{result.title}</strong>
                          <span>
                            {formatDistance(result.distanceMeters, units)} · {result.source.label}
                          </span>
                        </button>
                      ))}
                      {!!aiAnswer.answer.results.length && (
                        <div className="command-search-ai-actions">
                          <button
                            type="button"
                            className="btn small"
                            data-testid="search-ai-preview-plan"
                            onClick={previewAiPlan}
                          >
                            {aiPlanPreviewed
                              ? "Pracovní body jsou v mapě"
                              : "Ukázat všechny body v mapě"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-accent small"
                            data-testid="search-ai-create-plan"
                            onClick={createPlanFromAi}
                          >
                            Vytvořit editovatelný plán
                          </button>
                        </div>
                      )}
                      {aiSelection && (
                        <span
                          className="command-search-ai-selection"
                          data-testid="search-ai-selection"
                        >
                          Vybráno pro tuto konverzaci: <strong>{aiSelection.title}</strong>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {tagHits.map((item) => (
                <button
                  key={item.tag}
                  type="button"
                  className="search-hit"
                  onClick={() => pickTag(item.tag)}
                >
                  #{item.tag} <span className="meta">({item.count})</span>
                </button>
              ))}
              {hits.map((hit) => (
                <button
                  key={`${hit.lat},${hit.lon},${hit.display_name}`}
                  type="button"
                  className="search-hit"
                  onClick={() => pickHit(hit)}
                >
                  <strong className="search-hit-name">{hit.display_name}</strong>
                  {geocodeHierarchy(hit) && (
                    <span className="search-hit-hierarchy">{geocodeHierarchy(hit)}</span>
                  )}
                  <span className="search-hit-facts">
                    <span>{geocodeTypeLabel(hit.type)}</span>
                    <span>{hit.source?.label?.trim() || "MapOS geokodér"}</span>
                    <span
                      title={
                        hit.confidence?.basis === "provider-order"
                          ? "Orientační jistota podle pořadí výsledku poskytovatele"
                          : "Poskytovatel neuvedl jistotu"
                      }
                    >
                      Jistota: {hit.confidence?.label?.trim() || "neuvedena"}
                    </span>
                  </span>
                </button>
              ))}
              {networkIntent && searchSettled && !searching && !hits.length && !tagHits.length && (
                <div className="command-search-empty" role="status">
                  Nic jsme nenašli. Zkus přesnější název nebo vyber bod na mapě.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
