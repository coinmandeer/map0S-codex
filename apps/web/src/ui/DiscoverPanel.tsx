import { useEffect, useMemo, useRef, useState } from "react";
import { featureAnchor, type GuideItem } from "@mapos/layer-sdk";
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
import { addPlaceToPlanDocument } from "../info/placePlanAction";
import { apiGet } from "../lib/api";
import { emit, on } from "../lib/events";
import { createBlankPlanDocument } from "../planning/planDraft";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { taskRegistry } from "../tasks/TaskRegistry";
import { PanelShell } from "./PanelShell";
import {
  Accordion,
  Button,
  Icon,
  Chip,
  EmptyState,
  IconButton,
  InfoTip,
  InlineNotice,
  ListItem,
  ProgressCircular,
  Skeleton,
  Switch,
  type AccordionSection
} from "./kit";
import { ModuleErrorBoundary } from "./primitives/ModuleErrorBoundary";
import { DailyForecastDetails, forecastWeatherIcon } from "./weather/DailyForecastDetails";
import type { ForecastDay, ForecastHour } from "./weather/forecastDetails";
import { poiCategoryIcon } from "./layers/layerPresentation";
import { rememberDiscoverContribution } from "./contributionIntent";
import {
  discoverFactLine,
  discoverRegionLevelLabel,
  formatStatisticValue
} from "./discover/discoverModel";

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

/** Forecasts already paid for, keyed by the rounded coordinates the request uses.
 *
 *  The panel remounts the weather block whenever the map settles on a new position, and without
 *  this a two-metre correction of the map centre would buy the same forecast twice. */
const forecastCache = new Map<string, DiscoverForecast>();
const forecastRequests = new Map<string, Promise<DiscoverForecast>>();

function forecastKey(lng: number, lat: number): string {
  return `${lng.toFixed(4)}:${lat.toFixed(4)}`;
}

/** Failure carries the task id so the panel's retry can dismiss the right activity row. */
class ForecastError extends Error {
  constructor(readonly taskId: string) {
    super("Forecast request failed");
  }
}

function taskIdOf(error: unknown): string {
  return error instanceof ForecastError ? error.taskId : "";
}

/** One request per position, shared by every mount that asks for it while it is in flight. */
function loadForecast(lng: number, lat: number): Promise<DiscoverForecast> {
  const key = forecastKey(lng, lat);
  const cached = forecastCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = forecastRequests.get(key);
  if (pending) return pending;

  const task = taskRegistry.start({ type: "weather", label: "Načítám předpověď" });
  const request = apiGet<DiscoverForecast>("/info/weather", {
    query: { lng: lng.toFixed(4), lat: lat.toFixed(4) }
  })
    .then((data) => {
      taskRegistry.succeed(task.id, { received: data.hourly.length + data.daily.length });
      forecastCache.set(key, data);
      forecastRequests.delete(key);
      return data;
    })
    .catch(() => {
      forecastRequests.delete(key);
      taskRegistry.fail(task.id, {
        code: "WEATHER_FORECAST_FAILED",
        message: "Předpověď se nepodařila načíst",
        retryable: true
      });
      throw new ForecastError(task.id);
    });
  forecastRequests.set(key, request);
  return request;
}

function degrees(value: number | null): string {
  return value === null ? "" : `${Math.round(value)}°`;
}

/** The forecast is the most expensive block in the panel, so it is fetched the first time the
 *  section is opened and then kept for as long as the region stays the same (§4.4). */
function DiscoverWeather({
  lng,
  lat,
  active,
  onMap,
  onToggleMap,
  onSummary
}: {
  lng: number;
  lat: number;
  active: boolean;
  onMap: boolean;
  onToggleMap: () => void;
  onSummary: (summary: string | null) => void;
}) {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<ForecastState>(() => {
    const cached = forecastCache.get(forecastKey(lng, lat));
    return cached ? { status: "ready", data: cached } : { status: "idle" };
  });

  useEffect(() => {
    if (!active) return;
    if (state.status === "ready") return;
    let live = true;
    setState({ status: "loading" });
    loadForecast(lng, lat)
      .then((data) => {
        if (live) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (live) setState({ status: "error", taskId: taskIdOf(error) });
      });
    return () => {
      live = false;
    };
    // `state.status` is read but deliberately not a dependency: re-running on every status change
    // would restart the request the moment it resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lat, lng, retry]);

  const ready = state.status === "ready" ? state.data : null;
  useEffect(() => {
    if (!ready) return;
    const temperature = degrees(ready.current?.temperature ?? null);
    onSummary(
      temperature ? `${forecastWeatherIcon(ready.current?.code ?? null)} ${temperature}` : null
    );
  }, [onSummary, ready]);

  return (
    <div className="discover-weather">
      {state.status === "loading" && <Skeleton height={72} />}
      {state.status === "error" && (
        <InlineNotice
          tone="warning"
          action={
            <Button
              variant="text"
              size="sm"
              onClick={() => {
                taskRegistry.dismiss(state.taskId);
                forecastCache.delete(forecastKey(lng, lat));
                setRetry((value) => value + 1);
              }}
            >
              Zkusit znovu
            </Button>
          }
        >
          Předpověď se teď nepodařilo načíst.
        </InlineNotice>
      )}
      {state.status === "ready" && (
        <>
          <DailyForecastDetails
            daily={state.data.daily}
            hourly={state.data.hourly}
            compact
            className="discover-weather-days"
          />
          <Switch
            checked={onMap}
            label="Zobrazit na mapě"
            testId="discover-weather-on-map"
            onChange={onToggleMap}
          />
          <p className="discover-source-line">
            Zdroj:{" "}
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
  );
}

/** What is around the centre of the map (§4.4).
 *
 *  The panel reads top to bottom as an answer to "what is this place": name and breadcrumb,
 *  then the guide, then the numbers, then everything that is merely available. Nothing here
 *  invents data — a block whose source returned nothing is not rendered at all.
 */
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
  const [openSections, setOpenSections] = useState<string[]>(["guide"]);
  const [weatherSummary, setWeatherSummary] = useState<string | null>(null);
  const [highlightBoundary, setHighlightBoundary] = useState(true);
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

  // A new region invalidates the forecast summary shown in the section header.
  useEffect(() => setWeatherSummary(null), [context?.key]);

  // Turning the Events layer on is a request to see events, so that section opens itself. It
  // stays closable — this only reacts to the layer being switched on.
  const eventsOn = Boolean(activeLayers.events?.visible);
  useEffect(() => {
    if (!eventsOn) return;
    setOpenSections((current) => (current.includes("events") ? current : [...current, "events"]));
  }, [eventsOn]);

  useEffect(() => {
    if (
      mode !== "discover" ||
      !highlightBoundary ||
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
  }, [context, highlightBoundary, mode]);

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
    const [lng, lat] = featureAnchor(entry.feature);
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

  const addCentreToPlan = () => {
    const document = store.activePlanDocument ?? createBlankPlanDocument(view.lng, view.lat);
    const name = context?.region?.name ?? `${view.lat.toFixed(4)}, ${view.lng.toFixed(4)}`;
    try {
      store.setActivePlanDocument(
        addPlaceToPlanDocument(
          document,
          { id: `discover-${Date.now()}`, name, lng: view.lng, lat: view.lat },
          (prefix) => `${prefix}-${document.stops.length}-${Date.now()}`
        )
      );
      store.showToast(`${name} přidáno do plánu`);
    } catch {
      store.showToast("Plán už má maximum zastávek");
    }
  };

  const zoomToLevel = (level: string) => {
    const zooms: Record<string, number> = {
      country: 5,
      admin1: 7,
      admin2: 9,
      locality: 11,
      neighbourhood: 13
    };
    const zoom = zooms[level];
    if (zoom === undefined) return;
    emit("fly-to", { lng: view.lng, lat: view.lat, zoom });
    store.setView({ lng: view.lng, lat: view.lat, zoom });
  };

  if (!open || mode !== "discover") return null;

  const guide = context?.guideSynthesis ?? null;
  // The multi-source guide answers the section when it has anything to say; the older
  // single-source guide stays as the list underneath, so nothing that used to be visible is lost.
  const guideItems = context?.guide?.sections.flatMap((section) => section.items) ?? [];
  const guideLead = guide?.lead || context?.synthesis?.text || "";
  const sourceLabel = (sourceIds: readonly string[]): string | null => {
    const source = context?.sources.find((candidate) => sourceIds.includes(candidate.id));
    return source?.label ?? null;
  };
  // Provenance sits next to the text it backs (§30.5): the sources the lead came from plus, when
  // the guide itself supplied the highlights, its attribution.
  const guideSources = [
    ...new Set(
      [
        ...(
          guide?.highlights.flatMap((highlight) => highlight.sourceIds) ??
          context?.synthesis?.sourceIds ??
          []
        ).map((id) => sourceLabel([id])),
        context?.guide?.attribution
      ].filter((value): value is string => Boolean(value))
    )
  ];
  const practicalLines = [
    guide?.practical.arrival ? `Doprava: ${guide.practical.arrival}` : null,
    guide?.practical.bestTime ? `Kdy jet: ${guide.practical.bestTime}` : null,
    ...(guide?.practical.warnings ?? [])
  ].filter((value): value is string => Boolean(value));
  const flyTo = (longitude: number, latitude: number) => {
    emit("fly-to", { lng: longitude, lat: latitude, zoom: 16 });
    store.setView({ lng: longitude, lat: latitude, zoom: 16 });
    if (window.innerWidth < 900) store.setSidebarOpen(false);
  };

  const sections: AccordionSection[] = [];

  sections.push({
    id: "guide",
    title: "Průvodce",
    icon: "menu_book",
    testId: "discover-guide",
    children: (
      <div className="discover-guide">
        {contextState.status === "loading" && !context && <Skeleton height={72} count={2} />}
        {guideLead && (
          <ModuleErrorBoundary
            moduleId="discover-guide-synthesis"
            title="Souhrn oblasti"
            compact
            resetKey={guideLead}
          >
            <div data-testid="discover-summary">
              <p className="discover-lead">{guideLead}</p>
              <div className="discover-chip-row">
                {(guide?.kind ?? context?.synthesis?.kind) === "model" && (
                  <Chip label="AI souhrn" icon="auto_awesome" testId="discover-summary-ai" />
                )}
                {guideSources.map((label) => (
                  <Chip key={label} label={label} />
                ))}
              </div>
            </div>
          </ModuleErrorBoundary>
        )}
        {guide?.highlights.length ? (
          <div data-testid="discover-guide-highlights">
            <h3 className="discover-subheading">Stojí za to</h3>
            {guide.highlights.map((highlight) => (
              <ListItem
                key={`${highlight.title}:${highlight.sourceIds.join(",")}`}
                testId="discover-guide-highlight"
                icon="star"
                title={highlight.title}
                subtitle={[highlight.text, sourceLabel(highlight.sourceIds)]
                  .filter(Boolean)
                  .join(" · ")}
                {...(highlight.place
                  ? {
                      onClick: () => flyTo(highlight.place!.longitude, highlight.place!.latitude),
                      ariaLabel: `Ukázat ${highlight.title} na mapě`
                    }
                  : {})}
              />
            ))}
          </div>
        ) : null}
        {practicalLines.length > 0 && (
          <ul className="discover-source-list" data-testid="discover-guide-practical">
            {practicalLines.map((line) => (
              <li key={line}>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
        {guide?.degraded.length ? (
          <InlineNotice tone="info" testId="discover-guide-degraded">
            Část podkladů se teď nenačetla ({guide.degraded.join(", ")}); zbytek souhrnu platí.
          </InlineNotice>
        ) : null}
        {!guide?.highlights.length && guideItems.length > 0 && (
          <>
            <h3 className="discover-subheading">Stojí za to</h3>
            {guideItems.map((item) => (
              <ListItem
                key={item.sourceRef}
                testId="discover-guide-item"
                icon="place"
                title={item.name}
                subtitle={
                  [item.description, item.hours, item.price].filter(Boolean).join(" · ") ||
                  undefined
                }
                onClick={
                  item.lng !== undefined && item.lat !== undefined
                    ? () => flyToGuideItem(item)
                    : undefined
                }
              />
            ))}
          </>
        )}
        {!guideLead &&
          !guide?.highlights.length &&
          guideItems.length === 0 &&
          contextState.status !== "loading" && (
            <EmptyState
              icon="menu_book"
              title="O téhle oblasti zatím nic nemáme."
              actionLabel={guide?.action?.label ?? "Zeptat se AI"}
              onAction={() =>
                void controllerRef.current?.refresh({ ...viewport, allowModelFallback: true })
              }
              testId="discover-guide-empty"
            />
          )}
      </div>
    )
  });

  sections.push({
    id: "weather",
    title: "Počasí",
    icon: "rainy",
    testId: "discover-weather",
    action: weatherSummary ? <span className="kit-eyebrow">{weatherSummary}</span> : undefined,
    children: (
      <DiscoverWeather
        /* Keyed on the coordinates the request actually uses, so settling the map inside the
           same rounded position reuses the forecast instead of buying it again. */
        key={`${viewport.lng.toFixed(4)}:${viewport.lat.toFixed(4)}`}
        lng={viewport.lng}
        lat={viewport.lat}
        active={openSections.includes("weather")}
        onMap={Boolean(activeLayers.weather?.visible)}
        onToggleMap={() => store.toggleLayer("weather")}
        onSummary={setWeatherSummary}
      />
    )
  });

  if (context?.statistics.length) {
    sections.push({
      id: "statistics",
      title: "Čísla",
      icon: "bar_chart",
      testId: "discover-statistics",
      children: (
        <dl className="discover-stats">
          {context.statistics.map((statistic) => (
            <div key={statistic.id} data-testid={`discover-statistic-${statistic.id}`}>
              <dt>{statistic.label}</dt>
              <dd>
                {formatStatisticValue(statistic.value, statistic.unit)}
                <InfoTip title={statistic.label}>
                  {[
                    `${statistic.scope.regionName} · ${discoverRegionLevelLabel(statistic.scope.level)}`,
                    statistic.year ? `rok ${statistic.year}` : null,
                    statistic.uncertaintyLabel,
                    sourceLabel(statistic.sourceIds)
                      ? `zdroj: ${sourceLabel(statistic.sourceIds)}`
                      : null
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </InfoTip>
              </dd>
            </div>
          ))}
        </dl>
      )
    });
  }

  if (eventsOn) {
    sections.push({
      id: "events",
      title: "Události v okolí",
      icon: "event",
      testId: "discover-events",
      children: <EventExplorerPanel view={view} />
    });
  }

  if (placeMapFeatures.length > 0) {
    sections.push({
      id: "places",
      title: "Místa z aktivních vrstev",
      icon: "place",
      count: placeMapFeatures.length,
      testId: "discover-map-features",
      children: (
        <div className="discover-places">
          {placeMapFeatures.map((entry) => (
            <ListItem
              key={`${entry.layerId}:${String(entry.feature.properties.id)}`}
              testId="discover-map-feature"
              icon={poiCategoryIcon(entry.category)}
              title={entry.name}
              subtitle={entry.category}
              ariaLabel={`Otevřít detail místa ${entry.name}`}
              onClick={() => openMapFeature(entry)}
            />
          ))}
        </div>
      )
    });
  }

  if (context) {
    sections.push({
      id: "boundary",
      title: "Hranice oblasti",
      icon: "grid_on",
      testId: "discover-boundary",
      children: (
        <div className="discover-boundary">
          <Switch
            checked={highlightBoundary}
            label="Zvýraznit na mapě"
            testId="discover-boundary-highlight"
            onChange={setHighlightBoundary}
          />
          {context.boundary.status === "ready" && context.boundary.geometry ? (
            <div className="discover-boundary-ready" data-testid="discover-boundary-ready">
              <span>Správní hranice z OpenStreetMap</span>
              <Button
                variant="text"
                size="sm"
                icon="fullscreen"
                onClick={() => {
                  const bbox = discoverBoundaryBbox(context.boundary.geometry!);
                  if (bbox) emit("fit-bounds", { bbox });
                }}
              >
                Ukázat celou
              </Button>
            </div>
          ) : (
            <p className="discover-source-line">
              Přesná geometrie pro tuhle úroveň zatím není připojená.
            </p>
          )}
          {context.regionCatalogue?.regions.length ? (
            <div data-testid="discover-region-options">
              <h3 className="discover-subheading">Oblasti ve výřezu</h3>
              {context.regionCatalogue.regions.map((candidate) => (
                <ListItem
                  key={candidate.id}
                  testId={`discover-region-option-${candidate.code}`}
                  icon="public"
                  title={candidate.name}
                  subtitle={`${candidate.code} · NUTS ${candidate.nutsLevel}`}
                  onClick={() => {
                    const bbox = discoverBoundaryBbox(candidate.geometry);
                    if (!bbox) return;
                    const lng = (bbox[0] + bbox[2]) / 2;
                    const lat = (bbox[1] + bbox[3]) / 2;
                    emit("fly-to", { lng, lat, zoom: viewport.zoom });
                    store.setView({ lng, lat, zoom: viewport.zoom });
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      )
    });
  }

  if (context?.sources.length) {
    sections.push({
      id: "sources",
      title: "Zdroje a aktuálnost",
      icon: "info",
      testId: "discover-sources",
      children: (
        <ul className="discover-source-list">
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
      )
    });
  }

  return (
    <>
      <div
        className="discover-context-pin"
        data-testid="discover-context-pin"
        data-identified={context?.region ? true : undefined}
        aria-hidden="true"
      >
        <Icon
          name={context?.region ? "place" : "help"}
          size={20}
          filled={Boolean(context?.region)}
        />
      </div>
      <PanelShell
        title="Objevuj"
        testId="discover-panel"
        className="discover-panel"
        busy={contextState.status === "waiting" || contextState.status === "loading"}
        busyLabel="Zjišťuji kontext oblasti"
        headerExtra={
          <IconButton
            icon="add_location"
            label="Přispět místo"
            size="sm"
            testId="discover-contribute"
            onClick={openContribution}
          />
        }
      >
        <div className="discover-stack" data-testid="discover-context">
          <header className="discover-hero">
            <span className="kit-eyebrow">Střed mapy</span>
            <h2 className="discover-hero-title">
              {context?.region?.name ?? "Neidentifikovaná oblast"}
              {contextState.status === "loading" && !context && (
                <ProgressCircular size={16} label="Zjišťuji oblast" />
              )}
            </h2>
            {context?.region?.hierarchy.length ? (
              <nav className="discover-chip-row" aria-label="Hierarchie oblasti">
                {context.region.hierarchy.map((item) => (
                  <Chip
                    key={`${item.level}:${item.name}`}
                    label={item.name}
                    testId={`discover-crumb-${item.level}`}
                    onClick={() => zoomToLevel(item.level)}
                  />
                ))}
              </nav>
            ) : null}
            {context && (
              <p className="discover-facts">{discoverFactLine(context, placeMapFeatures.length)}</p>
            )}
            <div className="discover-actions">
              <Button
                variant="text"
                size="sm"
                icon="auto_awesome"
                testId="discover-here"
                disabled={contextState.status === "loading"}
                onClick={() =>
                  void controllerRef.current?.refresh({ ...viewport, allowModelFallback: true })
                }
              >
                Zjistit co je tady
              </Button>
              <Button
                variant="text"
                size="sm"
                icon="route"
                testId="discover-add-to-plan"
                onClick={addCentreToPlan}
              >
                Přidat do plánu
              </Button>
            </div>
          </header>

          {contextState.error && <InlineNotice tone="warning">{contextState.error}</InlineNotice>}

          <Accordion
            sections={sections}
            value={openSections}
            onValueChange={setOpenSections}
            testId="discover-accordion"
          />
        </div>
      </PanelShell>
    </>
  );
}
