import { maptilerGeocode } from "../search/maptilerGeocoding";
import { normalizeCatalogText } from "@mapos/layer-sdk";
import { SearchLayers } from "./layers/SearchLayers";
import { chatSession, useChatField } from "./ai/chatSession";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  const requestRunner = useRef(new LatestRequestRunner<SearchResponse>());
  const searchDebounce = useRef<number | undefined>(undefined);
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
  const searchRootRef = useRef<HTMLDivElement>(null);
  const [, setRecentRevision] = useState(0);
  const [aiBusy] = useChatField("busy");
  const [aiSessions] = useChatField("sessions");
  useEffect(() => {
    if (focused) void chatSession.refreshHistory();
  }, [focused]);
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
    setSearchSettled(false);
    setSearchError(null);
    setHits([]);
    setTagHits([]);
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
            try {
              const response = await fetch(
                `${API_BASE}/geocode?q=${encodeURIComponent(intent.query)}&provider=auto&autocomplete=true`,
                { signal }
              );
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              const data = (await response.json()) as { results?: GeoHit[] };
              const found = (data.results ?? []).filter(validGeoHit);
              if (found.length) return { hits: found, tagHits: [] };
            } catch (error) {
              signal.throwIfAborted();
              if (!store.capabilities?.maptilerGeocoding) throw error;
            }
            return {
              hits: await maptilerGeocode(intent.query, true, store.capabilities, signal),
              tagHits: []
            };
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
    searchDebounce.current = timer;
    return () => {
      mounted = false;
      window.clearTimeout(timer);
      runner.cancel("query-changed");
    };
  }, [intent, retrySearch, store.capabilities]);

  const clearResults = () => {
    setQuery("");
    setHits([]);
    setTagHits([]);
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
      confirmAiSearch();
    } else if (
      hits[0] &&
      (!aiEnabled ||
        normalizeCatalogText(hits[0].display_name.split(",")[0] ?? "") ===
          normalizeCatalogText(query))
    ) {
      pickHit(hits[0]);
    } else if (query.trim() && aiEnabled) {
      void requestAiSearch(query.trim());
    } else if (query.trim()) {
      window.clearTimeout(searchDebounce.current);
      const submitted = query.trim();
      setSearching(true);
      void requestRunner.current
        .run(
          async (signal) => {
            if (store.capabilities?.maptilerGeocoding) {
              try {
                const response = await fetch(
                  `${API_BASE}/geocode?q=${encodeURIComponent(submitted)}&provider=auto&autocomplete=true`,
                  { signal }
                );
                if (response.ok) {
                  const data = (await response.json()) as { results?: GeoHit[] };
                  const found = (data.results ?? []).filter(validGeoHit);
                  if (found.length) return { hits: found, tagHits: [] };
                }
                const found = await maptilerGeocode(submitted, false, store.capabilities, signal);
                if (found.length) return { hits: found, tagHits: [] };
              } catch {
                signal.throwIfAborted();
              }
            }
            const response = await fetch(
              `${API_BASE}/geocode?q=${encodeURIComponent(submitted)}&provider=auto`,
              { signal }
            );
            if (!response.ok) throw new Error("Hledání se nepodařilo dokončit.");
            const data = (await response.json()) as { results?: GeoHit[] };
            return { hits: (data.results ?? []).filter(validGeoHit), tagHits: [] };
          },
          ({ hits: results }) => {
            setHits(results);
            setSearchSettled(true);
            setSearching(false);
            if (results[0]) pickHit(results[0]);
          }
        )
        .catch(() => {
          setSearchError("Hledání se nepodařilo dokončit. Zkuste ho zopakovat.");
          setSearching(false);
        });
    }
  };

  const requestAiSearch = async (prompt: string) => {
    if (aiBusy || !aiEnabled) return;
    setFocused(false);
    setQuery("");
    shell.openAiContext(prompt);
  };
  const confirmAiSearch = () => {
    const prompt = intent.kind === "ai" ? intent.query : query.trim();
    if (prompt) void requestAiSearch(prompt);
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
  const showMenu = focused && (intent.kind === "empty" || label !== null || searching);
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

  // The menu closes on Escape wherever focus is, and on any press outside the search: clicking
  // the map canvas does not move focus, so relying on blur alone left the menu stuck open.
  useEffect(() => {
    if (!focused) return;
    const outside = (event: PointerEvent) => {
      if (searchRootRef.current?.contains(event.target as Node)) return;
      setFocused(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setFocused(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [focused]);

  const networkIntent =
    intent.kind === "address" ||
    intent.kind === "locality" ||
    intent.kind === "poi" ||
    intent.kind === "place" ||
    intent.kind === "category";

  return (
    <div
      ref={searchRootRef}
      className="topbar-search"
      data-focused={focused || undefined}
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
          onFocus={() => setFocused(true)}
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
          {aiEnabled && !query.trim() && (
            <section className="command-search-section" aria-label="AI / konverzace">
              <button
                type="button"
                className="search-hit"
                onClick={() => {
                  setFocused(false);
                  if (!chatSession.state.conversationId && aiSessions[0])
                    void chatSession.openConversation(aiSessions[0].id);
                  shell.openAiContext();
                }}
              >
                Pokračovat v konverzaci / historie
              </button>
              <button
                type="button"
                className="search-hit"
                onClick={() => {
                  chatSession.clear();
                  setFocused(false);
                  shell.openAiContext();
                }}
              >
                Nová konverzace
              </button>
              {aiSessions
                .filter((session) =>
                  normalizeCatalogText(session.title).includes(normalizeCatalogText(query))
                )
                .slice(0, 5)
                .map((session) => (
                  <button
                    type="button"
                    className="search-hit"
                    key={session.id}
                    onClick={() => {
                      setFocused(false);
                      void chatSession.openConversation(session.id);
                      shell.openAiContext();
                    }}
                  >
                    {session.title}
                  </button>
                ))}
            </section>
          )}
          <SearchLayers query={query} />
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
              {label && !networkIntent && (
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
              {networkIntent && intent.kind !== "category" && aiEnabled && (
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
                    {aiEnabled ? "Enter odešle dotaz AI." : "Žádná místa. Zkus přesnější název."}
                  </div>
                )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
