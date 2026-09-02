import { useEffect, useMemo, useRef, useState } from "react";
import type { GuideItem } from "@mapos/layer-sdk";
import {
  loadDiscoverContext,
  type DiscoverContext,
  type DiscoverViewport
} from "../discover/context";
import { discoverMapFeatures } from "../discover/mapFeatures";
import {
  StableViewportController,
  type StableViewportState
} from "../discover/StableViewportController";
import { discoverBoundaryBbox } from "../discover/boundary";
import { EventExplorerPanel } from "../events/EventExplorerPanel";
import { apiGet } from "../lib/api";
import { emit, on } from "../lib/events";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { taskRegistry } from "../tasks/TaskRegistry";
import { PanelShell } from "./PanelShell";
import { MAP_PRESETS, PIN_STYLES } from "./presets";
import { Icon, Skeleton } from "./primitives";
import { ModuleErrorBoundary } from "./primitives/ModuleErrorBoundary";
import { DailyForecastDetails, forecastWeatherIcon } from "./weather/DailyForecastDetails";
import type { ForecastDay, ForecastHour } from "./weather/forecastDetails";
import { rememberDiscoverContribution } from "./contributionIntent";

const INITIAL_STATE: StableViewportState<DiscoverContext> = {
  status: "idle",
  key: null,
  data: null,
  error: null,
  updatedAt: null
};

interface DiscoverForecast {
  current: {
    temperature: number | null;
    windSpeed: number | null;
    windDirection: number | null;
    code: number | null;
  } | null;
  hourly: ForecastHour[];
  daily: ForecastDay[];
  source: { label: string; url: string | null };
}

type ForecastState =
  | { status: "idle" | "loading" }
  | { status: "ready"; data: DiscoverForecast }
  | { status: "error"; taskId: string };

const REGION_LEVEL_LABELS: Record<NonNullable<DiscoverContext["region"]>["level"], string> = {
  country: "země",
  admin1: "kraj / region",
  admin2: "okres",
  locality: "město / obec",
  neighbourhood: "čtvrť"
};

const NUTS_LEVEL_LABELS = {
  0: "země",
  1: "velké regiony",
  2: "regiony",
  3: "menší regiony"
} as const;

function degrees(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}°`;
}

function compactDistance(distance: number): string {
  if (distance < 1_000) return `${Math.max(1, Math.round(distance / 10) * 10)} m`;
  return `${(distance / 1_000).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} km`;
}

function contextCapabilitySummary(context: DiscoverContext): { ready: number; total: number } {
  if (context.capabilities?.length) {
    return {
      ready: context.capabilities.filter((capability) => capability.status === "ready").length,
      total: context.capabilities.length
    };
  }
  const legacyBlocks = context.blocks.filter((block) => block.id !== "model");
  return {
    ready: legacyBlocks.filter((block) => block.status === "ready").length,
    total: legacyBlocks.length
  };
}

function DiscoverWeather({ lng, lat }: { lng: number; lat: number }) {
  const [requested, setRequested] = useState(false);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<ForecastState>({ status: "idle" });

  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    const task = taskRegistry.start({
      type: "weather",
      label: "Načítám předpověď",
      cancellable: true,
      cancel: () => controller.abort(),
      retry: () => setRetry((value) => value + 1)
    });
    setState({ status: "loading" });
    apiGet<DiscoverForecast>("/info/weather", {
      query: { lng: lng.toFixed(4), lat: lat.toFixed(4) },
      signal: controller.signal
    })
      .then((data) => {
        taskRegistry.succeed(task.id, { received: data.hourly.length + data.daily.length });
        setState({ status: "ready", data });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          taskRegistry.fail(task.id, {
            code: "WEATHER_FORECAST_FAILED",
            message: "Předpověď se nepodařila načíst",
            retryable: true
          });
          setState({ status: "error", taskId: task.id });
        }
      });
    return () => {
      if (!controller.signal.aborted) {
        controller.abort();
        taskRegistry.cancel(task.id);
      }
    };
  }, [lat, lng, requested, retry]);

  return (
    <details
      className="discover-accordion discover-weather"
      data-testid="discover-weather"
      onToggle={(event) => {
        if (event.currentTarget.open) setRequested(true);
      }}
    >
      <summary>
        <span className="discover-accordion-icon" aria-hidden="true">
          <Icon name="cloud" size={19} />
        </span>
        <span>
          <strong>Počasí</strong>
          <small>
            {state.status === "ready" ? (
              <span className="discover-accordion-value">
                {forecastWeatherIcon(state.data.current?.code ?? null)}{" "}
                {degrees(state.data.current?.temperature ?? null)}
              </span>
            ) : (
              "Předpověď pro střed mapy"
            )}
          </small>
        </span>
      </summary>
      <div className="discover-accordion-body">
        {state.status === "loading" && <Skeleton height={72} />}
        {state.status === "error" && (
          <div className="discover-inline-state">
            <span>Předpověď se teď nepodařilo načíst.</span>
            <button
              className="btn small"
              type="button"
              onClick={() => {
                taskRegistry.dismiss(state.taskId);
                setRetry((value) => value + 1);
              }}
            >
              Zkusit znovu
            </button>
          </div>
        )}
        {state.status === "ready" && (
          <>
            {state.data.current && (
              <div className="discover-weather-now">
                <span aria-hidden="true">{forecastWeatherIcon(state.data.current.code)}</span>
                <strong>{degrees(state.data.current.temperature)}</strong>
                <small>
                  Vítr{" "}
                  {state.data.current.windSpeed === null
                    ? "—"
                    : `${Math.round(state.data.current.windSpeed)} km/h`}
                </small>
              </div>
            )}
            <DailyForecastDetails
              daily={state.data.daily}
              hourly={state.data.hourly}
              compact
              className="discover-weather-days"
            />
            <p className="meta discover-weather-source">
              Načteno až po otevření · Zdroj:{" "}
              {state.data.source.url ? (
                <a href={state.data.source.url} target="_blank" rel="noreferrer noopener">
                  {state.data.source.label}
                </a>
              ) : (
                state.data.source.label
              )}
            </p>
          </>
        )}
      </div>
    </details>
  );
}

function statusText(status: StableViewportState<DiscoverContext>["status"]): string {
  if (status === "waiting") return "Mapa se ustaluje…";
  if (status === "loading") return "Ověřuji dostupné zdroje…";
  if (status === "error") return "Kontext se nepodařilo načíst.";
  if (status === "ready") return "Kontext odpovídá tomuto výřezu.";
  return "Posuň mapu nebo obnov kontext ručně.";
}

export function DiscoverPanel() {
  const store = getMapStore();
  const open = useMapStoreSnapshot((state) => state.sidebarOpen);
  const mode = useMapStoreSnapshot((state) => state.mode);
  const view = useMapStoreSnapshot((state) => state.view);
  const activeLayers = useMapStoreSnapshot((state) => state.activeLayers);
  const activePresetId = useMapStoreSnapshot((state) => state.activePresetId);
  const visibleFeatures = useMapStoreSnapshot((state) => state.visibleFeatures);
  const [mapViewport, setMapViewport] = useState<DiscoverViewport | null>(null);
  const [contextState, setContextState] =
    useState<StableViewportState<DiscoverContext>>(INITIAL_STATE);
  const controllerRef = useRef<StableViewportController<DiscoverContext> | null>(null);
  const contextTaskIdRef = useRef<string | null>(null);
  const latestViewportRef = useRef<DiscoverViewport | null>(null);

  const activeLayerIds = useMemo(
    () =>
      Object.entries(activeLayers)
        .filter(([, state]) => state.visible)
        .map(([id]) => id)
        .sort(),
    [activeLayers]
  );
  const viewport = useMemo<DiscoverViewport>(
    () => ({
      ...(mapViewport ?? view),
      activeLayerIds,
      useCase: activePresetId ?? "discover"
    }),
    [activeLayerIds, activePresetId, mapViewport, view]
  );
  const mapFeatures = useMemo(
    () => discoverMapFeatures(activeLayers, visibleFeatures, view),
    [activeLayers, visibleFeatures, view]
  );
  const placeMapFeatures = useMemo(
    () => mapFeatures.filter((entry) => entry.layerId !== "events"),
    [mapFeatures]
  );
  const activePreset = MAP_PRESETS.find((preset) => preset.id === activePresetId) ?? null;
  const presetRecommendations = placeMapFeatures.slice(0, 3);
  latestViewportRef.current = viewport;

  useEffect(() => {
    const controller = new StableViewportController<DiscoverContext>({
      request: async (requestViewport, outerSignal) => {
        const previousTaskId = contextTaskIdRef.current;
        if (previousTaskId) {
          const previous = taskRegistry.get(previousTaskId);
          if (previous?.status === "failed") taskRegistry.dismiss(previousTaskId);
          else if (previous && ["queued", "running"].includes(previous.status)) {
            taskRegistry.markStale(previousTaskId, "Kontext se změnil");
          }
        }

        const requestController = new AbortController();
        const relayAbort = () => requestController.abort();
        outerSignal.addEventListener("abort", relayAbort, { once: true });
        const task = taskRegistry.start({
          type: "layer-query",
          label: "Zjišťuji kontext oblasti",
          cancellable: true,
          cancel: () => requestController.abort(),
          retry: async () => {
            const latest = latestViewportRef.current;
            if (latest) await controllerRef.current?.refresh(latest);
          }
        });
        contextTaskIdRef.current = task.id;

        try {
          const data = await loadDiscoverContext(requestViewport, requestController.signal);
          if (requestController.signal.aborted || outerSignal.aborted) {
            taskRegistry.markStale(task.id, "Kontext se změnil");
            const error = new Error("Discover context request was replaced");
            error.name = "AbortError";
            throw error;
          }
          taskRegistry.succeed(task.id, {
            received:
              Number(Boolean(data.region)) +
              Number(Boolean(data.guide)) +
              Number(Boolean(data.boundary.geometry)) +
              (data.statistics?.length ?? 0)
          });
          return data;
        } catch (error) {
          if (requestController.signal.aborted || outerSignal.aborted) {
            taskRegistry.markStale(task.id, "Kontext se změnil");
          } else {
            taskRegistry.fail(task.id, {
              code: "DISCOVER_CONTEXT_FAILED",
              message: "Kontext oblasti se nepodařilo načíst",
              retryable: true
            });
          }
          throw error;
        } finally {
          outerSignal.removeEventListener("abort", relayAbort);
          if (taskRegistry.get(task.id)?.status !== "failed") {
            if (contextTaskIdRef.current === task.id) contextTaskIdRef.current = null;
          }
        }
      },
      onState: setContextState
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
      const taskId = contextTaskIdRef.current;
      if (taskId) {
        const task = taskRegistry.get(taskId);
        if (task?.status === "failed") taskRegistry.dismiss(taskId);
        else if (task && ["queued", "running"].includes(task.status)) {
          taskRegistry.markStale(taskId, "Panel byl zavřen");
        }
      }
      contextTaskIdRef.current = null;
    };
  }, []);

  useEffect(() => on("discover-viewport", setMapViewport), []);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (!open || mode !== "discover") {
      controller.pause();
      return;
    }
    controller.observe(viewport);
  }, [mode, open, viewport]);

  const context = contextState.data;
  useEffect(() => {
    if (
      mode !== "discover" ||
      (!context?.boundary.geometry && !context?.regionCatalogue?.regions.length)
    ) {
      emit("discover-geojson", { geojson: { type: "FeatureCollection", features: [] } });
      return;
    }
    const features: GeoJSON.Feature[] =
      context.regionCatalogue?.regions.map((candidate) => ({
        type: "Feature",
        properties: {
          id: candidate.id,
          name: candidate.name,
          code: candidate.code,
          nutsLevel: candidate.nutsLevel,
          kind: "candidate",
          sourceId: candidate.sourceId
        },
        geometry: candidate.geometry as GeoJSON.Geometry
      })) ?? [];
    if (context.boundary.geometry) {
      features.push({
        type: "Feature",
        properties: {
          id: context.region?.id,
          name: context.region?.name,
          level: context.region?.level,
          kind: "selected",
          sourceId: context.boundary.sourceId
        },
        geometry: context.boundary.geometry as GeoJSON.Geometry
      });
    }
    emit("discover-geojson", {
      geojson: {
        type: "FeatureCollection",
        features
      }
    });
  }, [context, mode]);

  useEffect(
    () =>
      on("discover-click", (properties) => {
        if (properties.kind !== "candidate") return;
        const lng = Number(properties.lng);
        const lat = Number(properties.lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
        emit("fly-to", { lng, lat, zoom: viewport.zoom });
        store.setView({ lng, lat, zoom: viewport.zoom });
      }),
    [store, viewport.zoom]
  );

  const flyToGuideItem = (item: GuideItem) => {
    if (item.lng === undefined || item.lat === undefined) return;
    emit("fly-to", { lng: item.lng, lat: item.lat, zoom: 16 });
    store.setView({ lng: item.lng, lat: item.lat, zoom: 16 });
    if (window.innerWidth < 900) store.setSidebarOpen(false);
  };

  const openMapFeature = (entry: (typeof mapFeatures)[number]) => {
    const [lng, lat] = entry.feature.geometry.coordinates;
    emit("fly-to", { lng, lat, zoom: 16 });
    store.setView({ lng, lat, zoom: 16 });
    store.selectPin({ feature: entry.feature, layerId: entry.layerId });
    if (window.innerWidth < 900) store.setSidebarOpen(false);
  };

  const openContribution = () => {
    rememberDiscoverContribution({
      source: "discover",
      ...(context?.region?.id ? { regionId: context.region.id } : {}),
      ...(context?.region?.name ? { regionName: context.region.name } : {})
    });
    store.openSheet("wizard");
  };

  if (!open || mode !== "discover") return null;

  return (
    <>
      <div className="discover-context-pin" data-testid="discover-context-pin" aria-hidden="true">
        <span>?</span>
      </div>
      <PanelShell
        title="Objevuj"
        testId="discover-panel"
        className="discover-panel"
        headerExtra={
          <button className="btn small" type="button" onClick={openContribution}>
            ＋ Přispět
          </button>
        }
      >
        <div className="discover-context" data-testid="discover-context">
          <header className="discover-hero">
            <div className="discover-hero-heading">
              <span className="discover-hero-icon" aria-hidden="true">
                <Icon name="compass" size={22} />
              </span>
              <div>
                <p className="discover-eyebrow">Průvodce středem mapy</p>
                <h3>{context?.region?.name ?? "Aktuální výřez"}</h3>
              </div>
              <span className="discover-live-badge" data-state={contextState.status}>
                {contextState.status === "loading"
                  ? "Načítám"
                  : context?.cache.hit
                    ? "Z cache"
                    : "Aktuální"}
              </span>
            </div>
            {context?.region?.hierarchy.length ? (
              <nav className="discover-crumb" aria-label="Hierarchie oblasti">
                {context.region.hierarchy.map((item, index) => (
                  <span key={`${item.level}:${item.name}`}>
                    {index > 0 && " / "}
                    {item.name}
                  </span>
                ))}
              </nav>
            ) : (
              <p className="meta">Kontext se určí podle středu a měřítka mapy.</p>
            )}
            <div className="discover-context-actions">
              <button
                className="btn btn-accent"
                type="button"
                onClick={() =>
                  void controllerRef.current?.refresh({ ...viewport, allowModelFallback: true })
                }
                disabled={contextState.status === "loading"}
              >
                <Icon name="sparkles" size={16} />
                {contextState.status === "loading" ? "Zjišťuji…" : "Zjistit co je tady"}
              </button>
              <span className="meta" role="status" aria-live="polite">
                {statusText(contextState.status)}
              </span>
            </div>
          </header>

          {contextState.error && <p className="discover-error">{contextState.error}</p>}

          {contextState.status === "loading" && !context && (
            <div className="discover-loading" aria-label="Načítám průvodce">
              <Skeleton height={92} />
              <Skeleton height={56} count={2} />
            </div>
          )}

          {context && (
            <div className="discover-facts" aria-label="Rychlý přehled výřezu">
              <div>
                <span className="discover-fact-icon">
                  <Icon name="globe" size={16} />
                </span>
                <strong>
                  {context.region ? REGION_LEVEL_LABELS[context.region.level] : "výřez"}
                </strong>
                <small>úroveň oblasti</small>
              </div>
              <div>
                <span className="discover-fact-icon">
                  <Icon name="pin" size={16} />
                </span>
                <strong>{mapFeatures.length}</strong>
                <small>míst v mapě</small>
              </div>
              <div>
                <span className="discover-fact-icon">
                  <Icon name="layers" size={16} />
                </span>
                <strong>
                  {contextCapabilitySummary(context).ready}/
                  {contextCapabilitySummary(context).total}
                </strong>
                <small>datových modulů</small>
              </div>
            </div>
          )}

          <section className="discover-contribute" data-testid="discover-contribute">
            <span className="discover-contribute-icon" aria-hidden="true">
              <Icon name="pin" size={21} />
            </span>
            <div>
              <p className="discover-eyebrow">Komunitní mapa</p>
              <h4>Znáš to tu? Doplň místo nebo místní tip.</h4>
              <p>
                Příspěvek se uloží jako dohledatelná revize s autorem a původem. Veřejně se ukáže až
                po kontrole — koncept můžeš kdykoli odložit.
              </p>
              <ol aria-label="Postup příspěvku">
                <li>Koncept</li>
                <li>Kontrola</li>
                <li>Zveřejnění</li>
              </ol>
            </div>
            <button className="btn btn-accent" type="button" onClick={openContribution}>
              Přidat místní znalost
            </button>
          </section>

          {context?.regionCatalogue?.regions.length ? (
            <section
              className="discover-section discover-region-options"
              data-testid="discover-region-options"
            >
              <div className="discover-block-title">
                <div>
                  <p className="discover-eyebrow">Oblasti ve výřezu</p>
                  <h4>Sousední správní plochy</h4>
                </div>
                <span>NUTS {context.regionCatalogue.nutsLevel}</span>
              </div>
              <p className="meta">
                Modré plochy odpovídají měřítku mapy. Klepni přímo do plochy, nebo oblast zaměř
                tlačítkem; detailní body zůstávají nad hranicemi klikatelné.
              </p>
              <div className="discover-region-options-strip">
                {context.regionCatalogue.regions.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    data-testid={`discover-region-option-${candidate.code}`}
                    aria-label={`Zaměřit oblast ${candidate.name}`}
                    onClick={() => {
                      const bbox = discoverBoundaryBbox(candidate.geometry);
                      if (!bbox) return;
                      const lng = (bbox[0] + bbox[2]) / 2;
                      const lat = (bbox[1] + bbox[3]) / 2;
                      emit("fly-to", { lng, lat, zoom: viewport.zoom });
                      store.setView({ lng, lat, zoom: viewport.zoom });
                    }}
                  >
                    <span className="discover-region-option-icon" aria-hidden="true">
                      <Icon name="globe" size={16} />
                    </span>
                    <span>
                      <strong>{candidate.name}</strong>
                      <small>
                        {candidate.code} · {NUTS_LEVEL_LABELS[candidate.nutsLevel]}
                      </small>
                    </span>
                    <Icon name="chevronRight" size={15} />
                  </button>
                ))}
              </div>
              {context.regionCatalogue.truncated ? (
                <small className="discover-region-options-note">
                  Zobrazuji prvních {context.regionCatalogue.regions.length} ploch; další se doplní
                  po posunu mapy.
                </small>
              ) : null}
            </section>
          ) : null}

          <section
            className="discover-section discover-usecase"
            data-testid="discover-usecase"
            data-active-preset={activePreset?.id ?? "none"}
          >
            <div className="discover-block-title">
              <div>
                <p className="discover-eyebrow">Kontext podle tvého záměru</p>
                <h4>
                  {activePreset ? `${activePreset.icon} ${activePreset.name}` : "Co chceš objevit?"}
                </h4>
              </div>
              <span>{activePreset ? "aktivní výběr" : "vyber režim"}</span>
            </div>
            <div className="discover-usecase-strip" role="group" aria-label="Zaměření objevování">
              {MAP_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="discover-usecase-chip"
                  aria-pressed={activePreset?.id === preset.id}
                  data-testid={`discover-preset-${preset.id}`}
                  onClick={() => store.applyPreset(preset)}
                >
                  <span aria-hidden="true">{preset.icon}</span>
                  {preset.name}
                </button>
              ))}
            </div>
            {activePreset ? (
              <div className="discover-usecase-content">
                <p>{activePreset.description}. Výběr mění vrstvy, místa i další souhrn oblasti.</p>
                {presetRecommendations.length ? (
                  <div
                    className="discover-usecase-recommendations"
                    aria-label={`Tipy pro ${activePreset.name}`}
                  >
                    {presetRecommendations.map((entry) => (
                      <button
                        key={`${entry.layerId}:${String(entry.feature.properties.id)}`}
                        type="button"
                        onClick={() => openMapFeature(entry)}
                      >
                        <span className="discover-card-pin" aria-hidden="true">
                          {PIN_STYLES[entry.category]?.icon ?? <Icon name="pin" size={14} />}
                        </span>
                        <span>
                          <strong>{entry.name}</strong>
                          <small>
                            {PIN_STYLES[entry.category]?.label ?? entry.category} ·{" "}
                            {compactDistance(entry.distance)}
                          </small>
                        </span>
                        <Icon name="chevronRight" size={15} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="meta discover-usecase-empty">
                    Hledám vhodná místa v aktuálním výřezu. Výsledek se doplní bez druhého dotazu.
                  </p>
                )}
              </div>
            ) : (
              <p className="meta discover-usecase-empty">
                Zvol zaměření a MapOS přizpůsobí kategorie v mapě i kontextový souhrn — vše lze dál
                upravit ručně.
              </p>
            )}
          </section>

          {context?.statistics?.length ? (
            <section
              className="discover-section discover-statistics"
              data-testid="discover-statistics"
            >
              <div className="discover-block-title">
                <div>
                  <p className="discover-eyebrow">Otevřená data o oblasti</p>
                  <h4>Čísla se zdrojem a rozsahem</h4>
                </div>
                <span>
                  {context.statistics.length}{" "}
                  {context.statistics.length === 1 ? "dostupný údaj" : "dostupné údaje"}
                </span>
              </div>
              <div className="discover-statistics-grid">
                {context.statistics.map((statistic) => {
                  const source = context.sources.find((candidate) =>
                    statistic.sourceIds.includes(candidate.id)
                  );
                  const formattedValue =
                    statistic.unit === "eur-per-person"
                      ? statistic.value.toLocaleString("cs-CZ", {
                          style: "currency",
                          currency: "EUR",
                          maximumFractionDigits: 0
                        })
                      : statistic.value.toLocaleString("cs-CZ");
                  return (
                    <article key={statistic.id} data-testid={`discover-statistic-${statistic.id}`}>
                      <header>
                        <span className="discover-statistic-icon" aria-hidden="true">
                          <Icon name={statistic.id === "population" ? "user" : "globe"} size={18} />
                        </span>
                        <span>
                          <small>{statistic.label}</small>
                          <strong>{formattedValue}</strong>
                        </span>
                        <span className="discover-statistic-quality">
                          {statistic.uncertainty === "regional-aggregate"
                            ? "regionální"
                            : "orientační"}
                        </span>
                      </header>
                      <dl>
                        <div>
                          <dt>Území</dt>
                          <dd>
                            {statistic.scope.regionName} ·{" "}
                            {REGION_LEVEL_LABELS[statistic.scope.level]}
                            {statistic.scope.geographicCode
                              ? ` · ${statistic.scope.geographicCode}`
                              : ""}
                          </dd>
                        </div>
                        <div>
                          <dt>Rok údaje</dt>
                          <dd>{statistic.year ?? "ve zdroji neuveden"}</dd>
                        </div>
                      </dl>
                      <p>{statistic.uncertaintyLabel}</p>
                      {source ? (
                        <a href={source.url} target="_blank" rel="noreferrer noopener">
                          Zdroj: {source.label}
                        </a>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {context?.synthesis && (
            <ModuleErrorBoundary
              moduleId="discover-ai-conversation"
              title="AI souhrn oblasti"
              compact
              resetKey={`${context.synthesis.kind}:${context.synthesis.text}`}
            >
              <section className="discover-section discover-brief" data-testid="discover-summary">
                <div className="discover-section-heading">
                  <span
                    className={
                      context.synthesis.kind === "model"
                        ? "discover-ai-mark"
                        : "discover-source-mark"
                    }
                  >
                    {context.synthesis.kind === "model" ? "AI" : <Icon name="bookmark" size={16} />}
                  </span>
                  <div>
                    <p className="discover-eyebrow">
                      {context.synthesis.kind === "model"
                        ? "AI nad veřejným kontextem"
                        : "Zdrojový kontext"}
                    </p>
                    <h4>{context.synthesis.label}</h4>
                  </div>
                </div>
                <p className="discover-summary">{context.synthesis.text}</p>
                {context.synthesis.kind === "model" && (
                  <p className="meta">
                    Modelový text je pomocný; ověřitelné podklady zůstávají uvedené níže.
                  </p>
                )}
              </section>
            </ModuleErrorBoundary>
          )}

          <DiscoverWeather
            key={context?.key ?? `${viewport.lng}:${viewport.lat}`}
            lng={viewport.lng}
            lat={viewport.lat}
          />

          {activeLayers.events?.visible && <EventExplorerPanel view={view} />}

          {context?.guide && (
            <div className="discover-guide" data-testid="discover-guide">
              <div className="discover-block-title">
                <div>
                  <p className="discover-eyebrow">Průvodce</p>
                  <h4>{context.guide.area}</h4>
                </div>
                <span>
                  {context.guide.sections.reduce(
                    (total, section) => total + section.items.length,
                    0
                  )}{" "}
                  tipů
                </span>
              </div>
              {context.guide.sections.map((section) => (
                <details key={section.id} className="discover-accordion discover-guide-section">
                  <summary>
                    <span className="discover-accordion-icon" aria-hidden="true">
                      <Icon name="compass" size={18} />
                    </span>
                    <span>
                      <strong>{section.title}</strong>
                      <small>
                        {section.items.length ? `${section.items.length} míst` : "Stručný přehled"}
                      </small>
                    </span>
                  </summary>
                  <div className="discover-accordion-body">
                    {section.intro && <p className="discover-guide-intro">{section.intro}</p>}
                    {section.items.length > 0 && (
                      <div className="discover-cards">
                        {section.items.map((item) => {
                          const locatable = item.lng !== undefined && item.lat !== undefined;
                          return (
                            <button
                              key={item.sourceRef}
                              className="discover-card"
                              type="button"
                              disabled={!locatable}
                              title={locatable ? "Zobrazit na mapě" : "Poloha ve zdroji chybí"}
                              onClick={() => flyToGuideItem(item)}
                            >
                              <span className="discover-card-pin" aria-hidden="true">
                                <Icon name="pin" size={15} />
                              </span>
                              <span className="discover-card-content">
                                <strong>{item.name}</strong>
                                {item.description && <small>{item.description}</small>}
                                {(item.hours || item.price) && (
                                  <span className="discover-card-kind">
                                    {[item.hours, item.price].filter(Boolean).join(" · ")}
                                  </span>
                                )}
                              </span>
                              {locatable && <Icon name="chevronRight" size={16} />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}

          {placeMapFeatures.length > 0 && (
            <details
              className="discover-boundary-gate discover-map-features"
              data-testid="discover-map-features"
            >
              <summary data-testid="discover-map-features-toggle">
                Místa z aktivních vrstev ({placeMapFeatures.length})
              </summary>
              <p className="meta">
                Stejné body jako v mapě, dostupné také klávesnicí a bez dalšího síťového dotazu.
              </p>
              <div className="discover-cards">
                {placeMapFeatures.map((entry) => (
                  <button
                    key={`${entry.layerId}:${String(entry.feature.properties.id)}`}
                    className="discover-card"
                    type="button"
                    data-testid="discover-map-feature"
                    aria-label={`Otevřít detail místa ${entry.name}`}
                    onClick={() => openMapFeature(entry)}
                  >
                    <span className="discover-card-pin" aria-hidden="true">
                      <Icon name="pin" size={15} />
                    </span>
                    <span className="discover-card-content">
                      <strong>{entry.name}</strong>
                      <span className="discover-card-kind">{entry.category}</span>
                    </span>
                    <Icon name="chevronRight" size={16} />
                  </button>
                ))}
              </div>
            </details>
          )}

          {context?.emptyState && (
            <section className="discover-empty" data-testid="discover-empty">
              <h4>{context.emptyState.title}</h4>
              <p>{context.emptyState.message}</p>
              <ul>
                {context.emptyState.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </section>
          )}

          {context && context.boundary.status !== "ready" && (
            <details className="discover-boundary-gate">
              <summary>Přesnost vybrané oblasti</summary>
              <p className="meta">
                Přesná správní geometrie zatím není připojená. Střed mapy a nalezená hierarchie
                zůstávají použitelné; obdélník výřezu nevydáváme za skutečnou hranici.
              </p>
            </details>
          )}

          {context?.boundary.status === "ready" && context.boundary.geometry && (
            <section className="discover-boundary-ready" data-testid="discover-boundary-ready">
              <span className="discover-boundary-ready-icon" aria-hidden="true">
                <Icon name="globe" size={18} />
              </span>
              <span>
                <strong>Správní hranice je v mapě</strong>
                <small>
                  Zjednodušená vektorová geometrie OpenStreetMap · klepnutím ji znovu otevřeš
                </small>
              </span>
              <button
                className="btn small"
                type="button"
                onClick={() => {
                  const bbox = discoverBoundaryBbox(context.boundary.geometry!);
                  if (bbox) emit("fit-bounds", { bbox });
                }}
              >
                Ukázat celou
              </button>
            </section>
          )}

          {context?.sources.length ? (
            <section className="discover-sources" aria-labelledby="discover-sources-title">
              <h4 id="discover-sources-title">Zdroje a aktuálnost</h4>
              <ul>
                {context.sources.map((source) => (
                  <li key={source.id}>
                    <a href={source.url} target="_blank" rel="noreferrer noopener">
                      {source.attribution}
                    </a>
                    <span>
                      {source.license ? `${source.license} · ` : ""}
                      načteno {new Date(source.fetchedAt).toLocaleDateString("cs-CZ")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </PanelShell>
    </>
  );
}
