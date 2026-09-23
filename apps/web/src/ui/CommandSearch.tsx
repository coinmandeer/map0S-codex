import { chatSession, useChatField } from "./ai/chatSession";
import { runChatTurn } from "./ai/runChatTurn";
import { showStatisticAnswer } from "./ai/statisticAnswer";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createAdjacentPlanSegments, planRoutePolicyHash } from "@mapos/layer-sdk";
import type { AppMode, AppModeInput } from "../product/registry";
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
import { emit } from "../lib/events";
import { geolocation, type Fix } from "../lib/geolocation";
import { formatDistance } from "../lib/units";
import { createBlankPlanDocument } from "../planning/planDraft";
import { t } from "../i18n";
import { LAYER_MODES } from "./modes";
import { Icon } from "./kit";

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
  answer: { text: string; results: AiSearchResult[] };
}

/** The one frame of `/v2/ai/chat` this popover needs; the panel reads the whole stream. */
interface AiChatAnswerEvent {
  type: "done";
  conversation: { id: string; revision: number };
  answer: {
    text: string;
    cards: {
      type: string;
      places?: {
        id: string;
        layerId: string;
        title: string;
        longitude: number;
        latitude: number;
        distanceMeters?: number;
        sourceId: string;
      }[];
    }[];
    sources: { sourceId: string; label: string; url?: string }[];
  };
}

function searchAnswerFromChat(answer: AiChatAnswerEvent["answer"]): AiSearchAnswer {
  const labels = new Map(answer.sources.map((source) => [source.sourceId, source]));
  const places = answer.cards.find((card) => card.type === "places")?.places ?? [];
  return {
    status: "succeeded",
    answer: {
      text: answer.text,
      results: places.slice(0, 4).map((place) => ({
        id: place.id,
        layerId: place.layerId,
        title: place.title,
        longitude: place.longitude,
        latitude: place.latitude,
        distanceMeters: place.distanceMeters ?? 0,
        source: labels.get(place.sourceId) ?? { sourceId: place.sourceId, label: place.sourceId }
      }))
    }
  };
}

function geocodeTypeLabel(value: string | undefined): string {
  const normalized = value?.toLocaleLowerCase("cs-CZ").replace(/^regional\./, "") ?? "";
  if (["house", "building", "address", "residential"].includes(normalized)) return "Adresa";
  if (["city", "town", "village", "municipality", "locality"].includes(normalized)) return "Obec";
  if (["state", "region", "county", "administrative", "regional"].includes(normalized))
    return "Region";
  if (["suburb", "neighbourhood", "city_district", "municipality_part"].includes(normalized))
    return "Část města";
  if (["poi", "amenity", "tourism", "shop", "leisure"].includes(normalized)) return "Místo / POI";
  return "Místo";
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
  if (intent.kind === "ai") return `Zeptat se AI: „${intent.query}“`;
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
  mode,
  showLocationLabel = false
}: {
  onFlyToMe: () => Promise<Fix | null>;
  mode: AppMode;
  /** Wide viewports get "Poloha" next to the target icon; narrow ones keep the tooltip only. */
  showLocationLabel?: boolean;
}) {
  const store = getMapStore();
  const shell = getShellStore();
  const activeTag = useMapStoreSnapshot((state) => state.activeTag);
  const view = useMapStoreSnapshot((state) => state.view);
  const aiEnabled = useMapStoreSnapshot((state) => state.preferences.aiEnabled);
  const units = useMapStoreSnapshot((state) => state.preferences.units);
  const requestRunner = useRef(new LatestRequestRunner<SearchResponse>());
  const menuRef = useRef<HTMLDivElement>(null);
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
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retrySearch, setRetrySearch] = useState(0);
  const [focused, setFocused] = useState(false);
  const [, setRecentRevision] = useState(0);
  const [aiPreviewOpen, setAiPreviewOpen] = useState(false);
  const [aiBusy] = useChatField("busy");
  const [aiTurns] = useChatField("turns");
  const aiTurn = aiTurns.at(-1);
  const aiError = aiTurn?.error;
  const aiAnswer = aiTurn ? searchAnswerFromChat(aiTurn) : null;
  const [aiSelection, setAiSelection] = useState<AiSearchResult | null>(null);
  const [aiPlanPreviewed, setAiPlanPreviewed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [justLocated, setJustLocated] = useState(false);
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

  // A brief filled/accented target after a fix, so the button confirms it did something even
  // when the map was already looking at you.
  useEffect(() => {
    if (!justLocated) return;
    const timer = window.setTimeout(() => setJustLocated(false), 1000);
    return () => window.clearTimeout(timer);
  }, [justLocated]);

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
    setAiSelection(null);
    setAiPlanPreviewed(false);
    setSearchSettled(false);
    setSearchError(null);
    setHits([]);
    setTagHits([]);
    const networkIntent =
      !aiPreviewOpen &&
      (intent.kind === "address" ||
        intent.kind === "locality" ||
        intent.kind === "poi" ||
        intent.kind === "place" ||
        intent.kind === "category");
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
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
            setSearchError("Hledání se nepodařilo dokončit. Zkuste ho zopakovat.");
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
  }, [intent, retrySearch, aiPreviewOpen]);

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
    if (aiPreviewOpen && query.trim()) {
      void requestAiSearch(query.trim());
    } else if (intent.kind === "coordinates") {
      flyTo(intent.coordinates, intent.coordinates.normalized, intent);
    } else if (intent.kind === "map-share") {
      flyTo(intent.location, `Sdílené místo (${intent.location.provider})`, intent);
    } else if (intent.kind === "category") {
      pickTag(intent.tag);
    } else if (intent.kind === "ai" && aiEnabled) {
      confirmAiSearch();
    } else if (hits[0]) {
      pickHit(hits[0]);
    }
  };

  const requestAiSearch = async (prompt: string) => {
    if (aiBusy || !aiEnabled) return;
    setAiPreviewOpen(true);
    setAiSelection(null);
    setAiPlanPreviewed(false);
    await runChatTurn(prompt);
  };
  const confirmAiSearch = () => {
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
        conversationId: chatSession.state.conversationId ?? undefined,
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
      conversationIds: chatSession.state.conversationId ? [chatSession.state.conversationId] : [],
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
      if (fix) setJustLocated(true);
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
  const locationState = locating
    ? "locating"
    : justLocated
      ? "active"
      : permission === "denied"
        ? "denied"
        : "idle";
  const showMenu =
    aiPreviewOpen || (focused && (intent.kind === "empty" || label !== null || searching));
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const anchor = menu?.parentElement;
    if (!showMenu || !menu || !anchor) return;
    const place = () => {
      const viewport = window.visualViewport;
      const start = viewport?.offsetLeft ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const left = anchor.getBoundingClientRect().left;
      const gutter = 12;
      menu.style.maxWidth = `${Math.max(0, width - gutter * 2)}px`;
      menu.style.left = `${Math.max(start + gutter - left, Math.min(0, start + width - gutter - left - menu.offsetWidth))}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [showMenu]);
  const networkIntent =
    intent.kind === "address" ||
    intent.kind === "locality" ||
    intent.kind === "poi" ||
    intent.kind === "place" ||
    intent.kind === "category";

  return (
    <div
      className="topbar-search"
      data-focused={focused || aiPreviewOpen || undefined}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <span className="topbar-search-field">
        <Icon name="search" size={20} className="topbar-search-icon" />
        <input
          data-testid="place-search"
          aria-label={t("search.label")}
          placeholder={t("search.placeholder")}
          value={query}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showMenu}
          aria-controls="command-search-suggestions"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setAiPreviewOpen(false);
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
      </span>
      <button
        type="button"
        className="search-locate-btn"
        data-testid="location-btn"
        data-state={locationState}
        title={
          locationState === "denied" ? "Poloha je zakázaná v prohlížeči" : t("search.myLocation")
        }
        aria-label={t("search.myLocation")}
        aria-busy={locating}
        disabled={locating}
        onClick={() => void flyToMe()}
      >
        <Icon
          name={locating ? "progress_activity" : "my_location"}
          size={20}
          filled={locationState === "active"}
          className={locating ? "mapos-spin" : undefined}
        />
        {showLocationLabel && (
          <span className="search-locate-label">{t("search.myLocation.short")}</span>
        )}
      </button>

      {showMenu && (
        <div
          className="search-hits command-search-menu"
          ref={menuRef}
          id="command-search-suggestions"
          role="dialog"
          aria-label="Návrhy hledání"
        >
          {intent.kind === "empty" && !aiPreviewOpen ? (
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
              {!aiPreviewOpen && networkIntent && (
                <p className="command-search-section-title">
                  Hledání názvu nebo adresy · výsledky nejsou omezené na výřez mapy
                </p>
              )}
              {!aiPreviewOpen && label && (
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
                  {intent.kind === "ai" && !aiEnabled && (
                    <span className="meta">AI funkce jsou vypnuté v Nastavení</span>
                  )}
                </button>
              )}
              {!aiPreviewOpen && networkIntent && intent.kind !== "category" && aiEnabled && (
                <button
                  type="button"
                  className="search-hit command-search-ai-offer"
                  data-testid="search-offer-ai"
                  disabled={aiBusy}
                  onClick={confirmAiSearch}
                >
                  <strong>{aiBusy ? "AI hledá…" : `Zeptat se AI: „${query.trim()}“`}</strong>
                </button>
              )}
              {aiPreviewOpen && aiEnabled && (
                <div className="command-search-ai-preview" role="status">
                  <div className="command-search-ai-actions">
                    <strong>Konverzace nad mapou</strong>
                    {aiBusy && (
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => chatSession.stop()}
                      >
                        Zastavit
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        chatSession.clear();
                        setQuery("");
                      }}
                    >
                      Nové vlákno
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      aria-label="Zavřít AI náhled"
                      onClick={() => {
                        setAiPreviewOpen(false);
                        setFocused(false);
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {aiTurns.slice(0, -1).map((turn) => (
                    <details key={turn.id} className="command-search-section">
                      <summary>{turn.question}</summary>
                      <p>{turn.text}</p>
                    </details>
                  ))}
                  {aiTurn && <strong>{aiTurn.question}</strong>}
                  {aiBusy && <span role="status">{aiTurn?.step ?? "Doplňuji odpověď…"}</span>}
                  {aiError && <span className="command-search-ai-error">{aiError}</span>}
                  {aiAnswer && (
                    <div className="command-search-ai-answer" data-testid="search-ai-results">
                      <strong>AI odpověď</strong>
                      <span>{aiAnswer.answer.text}</span>
                      {aiTurn?.cards.map((card, index) =>
                        card.type === "statistic" ? (
                          <button
                            key={index}
                            type="button"
                            className="btn small"
                            onClick={() => showStatisticAnswer(card)}
                          >
                            {card.available ? "Zobrazit statistiku" : "Přiblížit zemi"} ·{" "}
                            {card.period}
                          </button>
                        ) : card.type === "facts" ? (
                          <details key={index} open>
                            <summary>{card.title}</summary>
                            <dl>
                              {card.items.map((item) => (
                                <div key={item.label}>
                                  <dt>{item.label}</dt>
                                  <dd>
                                    {item.value} <small>{item.note}</small>
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                        ) : null
                      )}
                      {aiTurn?.sources.map((source) =>
                        source.url ? (
                          <a
                            key={source.sourceId}
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {source.label}
                          </a>
                        ) : (
                          <small key={source.sourceId}>{source.label}</small>
                        )
                      )}
                      <div className="command-search-ai-actions">
                        {aiTurn?.followUps.map((question) => (
                          <button
                            type="button"
                            className="btn small"
                            disabled={aiBusy}
                            key={question}
                            onClick={() => {
                              setQuery(question);
                              void requestAiSearch(question);
                            }}
                          >
                            {question}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="btn small"
                          data-testid="search-ai-open-panel"
                          onClick={() => {
                            setAiPreviewOpen(false);
                            setFocused(false);
                            shell.openAiContext();
                          }}
                        >
                          Otevřít celou konverzaci
                        </button>
                        <button
                          type="button"
                          className="btn btn-accent small"
                          disabled={aiBusy || !query.trim()}
                          onClick={confirmAiSearch}
                        >
                          Odeslat otázku
                        </button>
                      </div>
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
                  </span>
                </button>
              ))}
              {searchError && (
                <div role="alert" className="command-search-section">
                  <span>{searchError}</span>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => setRetrySearch((value) => value + 1)}
                  >
                    Opakovat
                  </button>
                  <button
                    type="button"
                    className="btn-link"
                    aria-label="Zavřít chybu hledání"
                    onClick={() => {
                      setSearchError(null);
                      setSearchSettled(false);
                    }}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>
              )}
              {networkIntent &&
                searchSettled &&
                !searchError &&
                !searching &&
                !hits.length &&
                !tagHits.length && (
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
