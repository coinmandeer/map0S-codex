import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyPlanCommand,
  basemapById,
  planV1ToV2,
  resolvePlanRoutingRequestV2,
  restorePlanSnapshot,
  type GeoFeature,
  type PlanCommandV2,
  type PlanDocumentV2,
  type PlanRoutePreferenceV2,
  type PlanTemporalContextV2,
  type PlanTravelProfileV2,
  type Position,
  type TripPlan
} from "@mapos/layer-sdk";
import { apiGet, apiPost, apiSend } from "../lib/api";
import { t } from "../i18n/cs";
import { formatDistance as formatDistanceValue } from "../lib/units";
import type { DistanceUnits } from "../settings/preferences";
import { buildExternalPlanHandoffs } from "../planning/externalHandoff";
import { buildPlanItinerary } from "../planning/planItinerary";
import { createBlankPlanDocument } from "../planning/planDraft";
import { buildPlanShareUrl, planShareTokenFromLocation } from "../planning/planSharing";
import {
  longestRoutablePreview,
  routableSegmentPreviews,
  selectedPlanAlternative,
  summarizePlanSegments
} from "../planning/planPresentation";
import { geolocation, GeolocationError, messageFor } from "../lib/geolocation";
import { emit } from "../lib/events";
import { isRoutingAbortError, startRoutingPlanTask } from "../planning/routingTask";
import { getMapStore } from "../store/mapStore";
import { getShellStore } from "../store/shellStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { PanelShell } from "./PanelShell";
import { StopLocationInput, type StopLocationSelection } from "./planning/StopLocationInput";

const STOP_WINDOW_SIZE = 25;
const MAX_UNDO_SNAPSHOTS = 50;

const PROFILE_LABELS: Record<PlanTravelProfileV2, string> = {
  foot: "Pěšky",
  bike: "Kolo",
  car: "Osobní auto",
  moto: "Motorka",
  camper: "Karavan",
  truck: "Nákladní"
};

const PREFERENCE_LABELS: Record<PlanRoutePreferenceV2, string> = {
  fast: "Rychlá",
  short: "Krátká",
  nohwy: "Bez dálnic",
  adventure: "Dobrodružná"
};

const EXPORT_LABELS = {
  gpx: "GPX",
  geojson: "GeoJSON",
  kml: "KML",
  mapos: "MapOS JSON"
} as const;

interface ExportResponse {
  filename: string;
  mimeType: string;
  content: string;
}

interface AiStopResult {
  id: string;
  layerId: string;
  title: string;
  longitude: number;
  latitude: number;
  distanceMeters: number;
  source: { sourceId: string; label: string; url?: string };
}

interface AiStopAnswer {
  status: "succeeded";
  answer: { text: string; results: AiStopResult[] };
}

interface PlanShareLink {
  id: string;
  planId: string;
  permission: "view";
  createdAt: string;
  revokedAt: string | null;
}

interface PlanDiscussionMessage {
  id: string;
  revision: number;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  disclosure: string | null;
  createdAt: string;
}

interface PlanDiscussionThread {
  id: string;
  planId: string;
  revision: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  messages: PlanDiscussionMessage[];
}

interface AdventureCandidate {
  id: string;
  placeId: string;
  name: string;
  category: string;
  location: Position;
  segmentIndex: number;
  insertIndex: number;
  score: number;
  scoreBreakdown: {
    interest: number;
    detourEfficiency: number;
    sourceConfidence: number;
  };
  baselineDistanceM: number;
  viaDistanceM: number;
  detourM: number;
  detourPercent: number;
  source: { id: string; reference: string | null };
  explanation: string;
}

interface AdventureRecommendation {
  algorithm: {
    version: string;
    deterministic: true;
    formula: string;
    detourLimitPercent: number;
    minimumEndpointDistanceM: number;
  };
  suggestions: AdventureCandidate[];
  coverage: {
    totalSegments: number;
    scannedSegments: number;
    placesEvaluated: number;
    eligiblePlaces: number;
  };
  dataBudget: {
    sources: ["osm"];
    categories: string[];
    maxScannedSegments: number;
    maxRoutedCandidates: number;
    maxReturnedSuggestions: number;
    providerCalls: number;
  };
  sourceStates: Array<{ source: string; state: string; count: number }>;
  warnings: string[];
}

function localId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function localDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function initialDocument(
  canonical: PlanDocumentV2 | null,
  legacy: TripPlan | null,
  lng: number,
  lat: number
): PlanDocumentV2 {
  if (canonical) return canonical;
  if (!legacy) return createBlankPlanDocument(lng, lat);
  const source = legacy;
  return planV1ToV2(source, {
    now: source.updatedAt ?? source.createdAt ?? new Date().toISOString()
  });
}

function isPersisted(document: PlanDocumentV2 | null, legacy: TripPlan | null): boolean {
  // A canonical local draft always has timestamps, and its derived legacy projection inherits
  // them. Only the explicit repository marker proves a v2 document was persisted.
  return document
    ? document.metadata?.["dev.mapos.persisted"] === true
    : Boolean(legacy?.createdAt);
}

function formatDistance(metres: number, units: DistanceUnits): string {
  return formatDistanceValue(metres, units);
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

function formatDistanceDelta(metres: number, units: DistanceUnits): string {
  if (Math.abs(metres) < 50) return "stejná délka";
  const sign = metres > 0 ? "+" : "−";
  return `${sign}${formatDistance(Math.abs(metres), units)}`;
}

function formatDurationDelta(seconds: number): string {
  if (Math.abs(seconds) < 30) return "stejný čas";
  const sign = seconds > 0 ? "+" : "−";
  return `${sign}${formatDuration(Math.abs(seconds))}`;
}

function formatPlanTime(value: string | null | undefined): string {
  if (!value) return "čas není dostupný";
  return new Date(value).toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function triggerDownload(data: ExportResponse): void {
  const url = URL.createObjectURL(new Blob([data.content], { type: data.mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = data.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function editableCopyOfSharedPlan(plan: PlanDocumentV2): PlanDocumentV2 {
  const metadata = { ...(plan.metadata ?? {}) };
  delete metadata["dev.mapos.sharedReadOnly"];
  delete metadata["dev.mapos.persisted"];
  return {
    ...plan,
    id: localId("plan"),
    ownerId: null,
    visibility: "private",
    metadata
  };
}

function routePreviewForPlan(document: PlanDocumentV2) {
  const preview = longestRoutablePreview(document);
  if (!preview) return null;
  return {
    ...preview,
    profile: document.routePolicy.profile,
    segments: routableSegmentPreviews(document).map((segment) => ({
      ...segment,
      coordinates: segment.coordinates.map((position) => [...position] as [number, number])
    })),
    stops: document.stops.map((stop) => ({
      coordinates: [...stop.location.coordinates] as [number, number],
      order: stop.order + 1,
      name: stop.name
    }))
  };
}

export function PlanningPanel() {
  const store = getMapStore();
  const shell = getShellStore();
  const open = useMapStoreSnapshot((state) => state.sidebarOpen);
  const mode = useMapStoreSnapshot((state) => state.mode);
  const view = useMapStoreSnapshot((state) => state.view);
  const activePlan = useMapStoreSnapshot((state) => state.activePlan);
  const activeDocument = useMapStoreSnapshot((state) => state.activePlanDocument);
  const selectedRouteSegmentId = useMapStoreSnapshot((state) => state.selectedRouteSegmentId);
  const session = useMapStoreSnapshot((state) => state.session);
  const provider = useMapStoreSnapshot((state) => state.dataProvider);
  const activeLayers = useMapStoreSnapshot((state) => state.activeLayers);
  const visibleFeatures = useMapStoreSnapshot((state) => state.visibleFeatures);
  const basemapId = useMapStoreSnapshot((state) => state.basemapId);
  const aiEnabled = useMapStoreSnapshot((state) => state.preferences.aiEnabled);
  const units = useMapStoreSnapshot((state) => state.preferences.units);
  const [plan, setPlan] = useState<PlanDocumentV2>(() =>
    initialDocument(activeDocument, activePlan, view.lng, view.lat)
  );
  const [savedRevision, setSavedRevision] = useState<number | null>(() =>
    isPersisted(activeDocument, activePlan) ? (activeDocument?.revision ?? 1) : null
  );
  const [undoStack, setUndoStack] = useState<PlanDocumentV2[]>([]);
  const [stopWindowStart, setStopWindowStart] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sharedToken, setSharedToken] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : planShareTokenFromLocation(window.location.pathname, window.location.hash)
  );
  const [sharedPlanStatus, setSharedPlanStatus] = useState<"idle" | "loading" | "ready" | "error">(
    sharedToken ? "loading" : "idle"
  );
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareListLoading, setShareListLoading] = useState(false);
  const [shareLinks, setShareLinks] = useState<PlanShareLink[]>([]);
  const [newShareUrl, setNewShareUrl] = useState<string | null>(null);
  const [loadingSavedPlan, setLoadingSavedPlan] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [locatingStopId, setLocatingStopId] = useState<string | null>(null);
  const [locationFallback, setLocationFallback] = useState<{
    stopId: string;
    kind: "denied" | "unavailable";
    message: string;
  } | null>(null);
  const [aiStopBusyId, setAiStopBusyId] = useState<string | null>(null);
  const [aiStopAnswer, setAiStopAnswer] = useState<{
    stopId: string;
    prompt: string;
    text: string;
    results: AiStopResult[];
  } | null>(null);
  const [aiPlanOpen, setAiPlanOpen] = useState(false);
  const [aiPlanPrompt, setAiPlanPrompt] = useState("");
  const [aiPlanBusy, setAiPlanBusy] = useState(false);
  const [aiThreadLoading, setAiThreadLoading] = useState(false);
  const [aiThread, setAiThread] = useState<PlanDiscussionThread | null>(null);
  const [aiPlanAnswer, setAiPlanAnswer] = useState<{
    text: string;
    model: string;
    disclosure: string;
  } | null>(null);
  const [bikeBasemapDismissed, setBikeBasemapDismissed] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem("mapos:bike-basemap-recommendation") === "dismissed"
  );
  const [adventureDetourLimit, setAdventureDetourLimit] = useState(15);
  const [adventureBusy, setAdventureBusy] = useState(false);
  const [adventureRecommendation, setAdventureRecommendation] =
    useState<AdventureRecommendation | null>(null);
  const [temporalContext, setTemporalContext] = useState<PlanTemporalContextV2 | null>(null);
  const [temporalContextStatus, setTemporalContextStatus] = useState<
    "idle" | "loading" | "ready" | "unavailable"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const lastPublishedDocument = useRef<PlanDocumentV2 | null>(null);
  const loadedPlansForOwner = useRef<string | null>(null);
  const loadedThreadForPlan = useRef<string | null>(null);
  const cancelRouting = useRef<(() => boolean) | null>(null);
  const mapSuggestions = useMemo(() => {
    const suggestions: Array<{ feature: GeoFeature; layerId: string }> = [];
    const seen = new Set<string>();
    for (const [layerId, state] of Object.entries(activeLayers)) {
      if (!state.visible) continue;
      for (const feature of visibleFeatures[layerId] ?? []) {
        const id = String(feature.properties.id ?? feature.geometry.coordinates.join(","));
        const key = `${layerId}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        suggestions.push({ feature, layerId });
        if (suggestions.length >= 12) return suggestions;
      }
    }
    return suggestions;
  }, [activeLayers, visibleFeatures]);

  useEffect(() => {
    if (!selectedRouteSegmentId) return;
    const selectedCard = Array.from(
      document.querySelectorAll<HTMLElement>("[data-route-segment-id]")
    ).find((element) => element.dataset.routeSegmentId === selectedRouteSegmentId);
    selectedCard?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedRouteSegmentId]);

  const publishDocument = (document: PlanDocumentV2) => {
    lastPublishedDocument.current = document;
    store.setActivePlanDocument(document);
  };

  useEffect(() => {
    if (!activeDocument) return;
    if (activeDocument === lastPublishedDocument.current) {
      lastPublishedDocument.current = null;
      return;
    }
    if (
      activeDocument.id === plan.id &&
      activeDocument.revision === plan.revision &&
      activeDocument.updatedAt === plan.updatedAt
    ) {
      return;
    }
    setPlan(activeDocument);
    setSavedRevision(isPersisted(activeDocument, activePlan) ? activeDocument.revision : null);
    setUndoStack([]);
    setAiThread(null);
    loadedThreadForPlan.current = null;
    setError(null);
  }, [activeDocument, activePlan, plan.id, plan.revision, plan.updatedAt]);

  useEffect(() => {
    const ownerId = session?.id;
    if (
      !open ||
      mode !== "planning" ||
      !ownerId ||
      sharedToken ||
      activeDocument ||
      loadedPlansForOwner.current === ownerId
    ) {
      return;
    }
    loadedPlansForOwner.current = ownerId;
    let cancelled = false;
    setLoadingSavedPlan(true);
    void apiGet<{ plans: PlanDocumentV2[] }>("/v2/plans", { auth: true })
      .then(({ plans }) => {
        const latest = plans[0];
        // A local edit made while the request was in flight always wins over server hydration.
        if (cancelled || !latest || store.activePlanDocument) return;
        setPlan(latest);
        setSavedRevision(latest.revision);
        setUndoStack([]);
        lastPublishedDocument.current = latest;
        store.setActivePlanDocument(latest);
      })
      .catch(() => {
        if (loadedPlansForOwner.current === ownerId) loadedPlansForOwner.current = null;
      })
      .finally(() => {
        if (!cancelled) setLoadingSavedPlan(false);
      });
    return () => {
      cancelled = true;
      if (loadedPlansForOwner.current === ownerId) loadedPlansForOwner.current = null;
    };
  }, [activeDocument, mode, open, session?.id, sharedToken, store]);

  useEffect(() => {
    if (!sharedToken || !open || mode !== "planning") return;
    let cancelled = false;
    setSharedPlanStatus("loading");
    setError(null);
    void apiPost<{ permission: "view"; plan: PlanDocumentV2 }>("/v2/plans/shared/resolve", {
      token: sharedToken
    })
      .then(({ plan: sharedPlan }) => {
        if (cancelled) return;
        setPlan(sharedPlan);
        setSavedRevision(null);
        setUndoStack([]);
        setAiThread(null);
        setSharedPlanStatus("ready");
        store.setRoutePreview(routePreviewForPlan(sharedPlan), false);
      })
      .catch((cause) => {
        if (cancelled) return;
        setSharedPlanStatus("error");
        setError(cause instanceof Error ? cause.message : "Sdílený plán se nepodařilo otevřít");
      });
    return () => {
      cancelled = true;
    };
  }, [mode, open, sharedToken, store]);

  useEffect(() => {
    if (
      !aiPlanOpen ||
      sharedToken ||
      savedRevision === null ||
      loadedThreadForPlan.current === plan.id
    ) {
      return;
    }
    loadedThreadForPlan.current = plan.id;
    let cancelled = false;
    setAiThreadLoading(true);
    void apiGet<{ conversation: PlanDiscussionThread | null }>(
      `/v2/ai/plans/${encodeURIComponent(plan.id)}/discussion`,
      { auth: true }
    )
      .then(({ conversation }) => {
        if (!cancelled) setAiThread(conversation);
      })
      .catch(() => {
        if (loadedThreadForPlan.current === plan.id) loadedThreadForPlan.current = null;
      })
      .finally(() => {
        if (!cancelled) setAiThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [aiPlanOpen, plan.id, savedRevision, sharedToken]);

  useEffect(
    () => () => {
      cancelRouting.current?.();
    },
    []
  );

  useEffect(() => {
    const maximumStart = Math.max(
      0,
      Math.floor((Math.max(1, plan.stops.length) - 1) / STOP_WINDOW_SIZE) * STOP_WINDOW_SIZE
    );
    setStopWindowStart((current) => Math.min(current, maximumStart));
  }, [plan.stops.length]);

  if (!open || mode !== "planning") return null;

  const readOnlyShared = sharedToken !== null;

  const remember = (document: PlanDocumentV2) => {
    setUndoStack((current) => [...current.slice(-(MAX_UNDO_SNAPSHOTS - 1)), document]);
  };

  const applyCommand = (command: PlanCommandV2): PlanDocumentV2 | null => {
    setError(null);
    try {
      const result = applyPlanCommand(plan, {
        id: localId("command"),
        expectedRevision: plan.revision,
        command
      });
      remember(result.undoDocument);
      setPlan(result.plan);
      publishDocument(result.plan);
      if (command.type === "select-segment-alternative") updatePreview(result.plan);
      if (command.type !== "select-segment-alternative") setAdventureRecommendation(null);
      if (
        command.type !== "update-plan" &&
        command.type !== "upsert-annotation" &&
        command.type !== "remove-annotation"
      ) {
        setTemporalContext(null);
        setTemporalContextStatus("idle");
      }
      return result.plan;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Změnu plánu nelze použít");
      return null;
    }
  };

  const undo = () => {
    const snapshot = undoStack.at(-1);
    if (!snapshot) return;
    try {
      const restored = restorePlanSnapshot(plan, snapshot);
      setUndoStack((current) => current.slice(0, -1));
      setPlan(restored);
      publishDocument(restored);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Změnu nelze vrátit");
    }
  };

  const addStop = (feature?: GeoFeature) => {
    const coordinates = feature?.geometry.coordinates ?? [view.lng, view.lat];
    const insertIndex = plan.stops.length - 1;
    const next = applyCommand({
      type: "add-stop",
      index: insertIndex,
      stop: {
        id: localId("stop"),
        name: String(feature?.properties.name ?? `Zastávka ${plan.stops.length}`),
        location: { type: "Point", coordinates: [...coordinates] as Position },
        sourceFeatureId: feature ? String(feature.properties.id) : null,
        dwellMinutes: 20,
        status: "accepted"
      }
    });
    if (next) setStopWindowStart(Math.floor(insertIndex / STOP_WINDOW_SIZE) * STOP_WINDOW_SIZE);
  };

  const updateStopLocation = (stopId: string, lng: number, lat: number) => {
    applyCommand({
      type: "update-stop",
      stopId,
      patch: { location: { type: "Point", coordinates: [lng, lat] } }
    });
  };

  const selectStopLocation = (stopId: string, selection: StopLocationSelection) => {
    if (locationFallback?.stopId === stopId) setLocationFallback(null);
    applyCommand({
      type: "update-stop",
      stopId,
      patch: {
        name: selection.name,
        location: { type: "Point", coordinates: [selection.lng, selection.lat] }
      }
    });
  };

  const pickStopLocation = (stop: PlanDocumentV2["stops"][number], index: number) => {
    const [lng, lat] = stop.location.coordinates;
    shell.startMapPicker(
      {
        caller: {
          id: `planning-stop-${stop.id}`,
          label: `Vyber polohu zastávky ${index + 1}`,
          context: stop.name
        },
        cancelPolicy: "restore-original-view",
        originalView: { center: { lng: view.lng, lat: view.lat }, zoom: view.zoom },
        candidate: { lng, lat, label: stop.name }
      },
      (result) => {
        if (result.status !== "confirmed") return;
        if (locationFallback?.stopId === stop.id) setLocationFallback(null);
        updateStopLocation(stop.id, result.location.lng, result.location.lat);
        store.showToast(`Poloha „${stop.name}“ byla změněna`);
      }
    );
    if (Math.abs(lng - view.lng) > 0.000_001 || Math.abs(lat - view.lat) > 0.000_001) {
      emit("fly-to", { lng, lat, zoom: Math.max(view.zoom, 14) });
    }
  };

  const locateStop = async (stopId: string, stopName: string) => {
    setLocatingStopId(stopId);
    setLocationFallback(null);
    setError(null);
    try {
      const fix = await geolocation.locate(undefined, { timeoutMs: 10_000 });
      updateStopLocation(stopId, fix.lng, fix.lat);
      setLocationFallback(null);
      emit("fly-to", { lng: fix.lng, lat: fix.lat, zoom: Math.max(view.zoom, 15) });
      store.showToast(`„${stopName}“ používá tvoji polohu`);
    } catch (cause) {
      const denied = cause instanceof GeolocationError && cause.kind === "denied";
      setLocationFallback({
        stopId,
        kind: denied ? "denied" : "unavailable",
        message: messageFor(cause)
      });
    } finally {
      setLocatingStopId(null);
    }
  };

  const pickNewStop = () => {
    shell.startMapPicker(
      {
        caller: { id: "planning-new-stop", label: "Vyber novou zastávku" },
        cancelPolicy: "restore-original-view",
        originalView: { center: { lng: view.lng, lat: view.lat }, zoom: view.zoom },
        candidate: { lng: view.lng, lat: view.lat }
      },
      (result) => {
        if (result.status !== "confirmed") return;
        addStop({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [result.location.lng, result.location.lat]
          },
          properties: {
            id: localId("map-stop"),
            layerId: "map-picker",
            name: result.location.label ?? `Zastávka ${plan.stops.length}`
          }
        });
      }
    );
  };

  const openAiStopCandidate = (stopId: string, prompt: string, result: AiStopResult) => {
    shell.startMapPicker(
      {
        caller: {
          id: `planning-ai-stop-${stopId}`,
          label: "Potvrď AI návrh zastávky",
          context: result.title
        },
        cancelPolicy: "restore-original-view",
        originalView: { center: { lng: view.lng, lat: view.lat }, zoom: view.zoom },
        candidate: { lng: result.longitude, lat: result.latitude, label: result.title }
      },
      (pickerResult) => {
        if (pickerResult.status !== "confirmed") return;
        selectStopLocation(stopId, {
          name: pickerResult.location.label ?? result.title,
          lng: pickerResult.location.lng,
          lat: pickerResult.location.lat
        });
        setAiStopAnswer(null);
        store.showToast("AI návrh zastávky byl potvrzen");
      }
    );
    emit("fly-to", {
      lng: result.longitude,
      lat: result.latitude,
      zoom: Math.max(view.zoom, 14)
    });
    store.showToast(`AI návrh: ${result.title}`);
    setAiStopAnswer((current) => (current ? { ...current, stopId, prompt } : current));
  };

  const runAiStopQuery = async (stopId: string, prompt: string) => {
    const stop = plan.stops.find((candidate) => candidate.id === stopId);
    if (!stop || aiStopBusyId) return;
    const activeLayerIds = Object.entries(activeLayers)
      .filter(([id, state]) => id === "osm-poi" && state.visible)
      .map(([id]) => id);
    if (!activeLayerIds.length) {
      setError("Pro AI hledání zastávky nejdřív zapni POI vrstvu ve Vrstvách.");
      return;
    }
    setAiStopBusyId(stopId);
    setAiStopAnswer(null);
    setError(null);
    try {
      const [longitude, latitude] = stop.location.coordinates;
      const response = await apiPost<AiStopAnswer>("/v2/ai/orchestrate", {
        prompt,
        conversation: { mode: "new", scope: { type: "global" } },
        reference: { source: "explicit", longitude, latitude },
        activeLayerIds,
        radiusMeters: 10_000,
        limit: 4,
        preciseLocationConsent: true
      });
      setAiStopAnswer({
        stopId,
        prompt,
        text: response.answer.text,
        results: response.answer.results
      });
      const first = response.answer.results[0];
      if (first) openAiStopCandidate(stopId, prompt, first);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "AI návrh se nepodařilo připravit; ruční výběr zůstává dostupný."
      );
    } finally {
      setAiStopBusyId(null);
    }
  };

  const updatePreview = (document: PlanDocumentV2) => {
    store.setRoutePreview(routePreviewForPlan(document), false);
  };

  const findAdventureRoute = async () => {
    if (plan.routePolicy.preference !== "adventure" || adventureBusy) return;
    setAdventureBusy(true);
    setAdventureRecommendation(null);
    setError(null);
    try {
      const response = await apiPost<AdventureRecommendation>("/v2/routing/adventure", {
        plan,
        provider,
        detourLimitPercent: adventureDetourLimit,
        maximumSuggestions: 3
      });
      setAdventureRecommendation(response);
      if (!response.suggestions.length) {
        store.showToast("V tomto limitu nebylo nalezeno vhodné zajímavé místo");
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Dobrodružnou trasu se nepodařilo připravit"
      );
    } finally {
      setAdventureBusy(false);
    }
  };

  const calculate = async (document: PlanDocumentV2 = plan) => {
    setBusy(true);
    setError(null);
    setTemporalContext(null);
    setTemporalContextStatus(document.departureAt ? "loading" : "idle");
    const run = startRoutingPlanTask(document, provider);
    cancelRouting.current = run.cancel;
    try {
      const data = await run.result;
      setPlan(data.plan);
      publishDocument(data.plan);
      updatePreview(data.plan);
      if (data.plan.departureAt) {
        store.setTimeCursor(data.plan.departureAt, "preview");
        try {
          const context = await apiPost<PlanTemporalContextV2>("/v2/routing/temporal-context", {
            plan: data.plan,
            provider
          });
          setTemporalContext(context);
          setTemporalContextStatus(context.status === "active" ? "ready" : "unavailable");
        } catch {
          setTemporalContextStatus("unavailable");
        }
      }
      if (data.failedSegmentIds.length) {
        store.showToast(
          `${data.failedSegmentIds.length} úseků se nepodařilo spočítat; ostatní zůstaly dostupné`
        );
      }
    } catch (cause) {
      if (!isRoutingAbortError(cause)) {
        setError(cause instanceof Error ? cause.message : "Trasu se nepodařilo vypočítat");
      }
    } finally {
      if (cancelRouting.current === run.cancel) cancelRouting.current = null;
      setBusy(false);
    }
  };

  const applyAdventureCandidates = (candidates: AdventureCandidate[]) => {
    if (!candidates.length) return;
    const commands: PlanCommandV2[] = [...candidates]
      .sort((a, b) => b.insertIndex - a.insertIndex)
      .map((candidate) => ({
        type: "add-stop",
        index: candidate.insertIndex,
        stop: {
          id: localId("adventure-stop"),
          name: candidate.name,
          location: { type: "Point", coordinates: [...candidate.location] as Position },
          sourceFeatureId: candidate.placeId,
          dwellMinutes: 30,
          status: "accepted",
          notes: `Dobrodružný výběr ${candidate.score}/100 · ověřená zajížďka ${candidate.detourPercent.toFixed(1)} %`
        }
      }));
    const next = applyCommand({ type: "batch", commands });
    if (!next) return;
    setAdventureRecommendation(null);
    store.showToast(
      candidates.length === 1
        ? `„${candidates[0]!.name}“ je nová zastávka; přepočítávám trasu`
        : `${candidates.length} zajímavá místa jsou v plánu; přepočítávám trasu`
    );
    void calculate(next);
  };

  const save = async (): Promise<PlanDocumentV2 | null> => {
    setSaving(true);
    setError(null);
    try {
      const documentToSave = readOnlyShared ? editableCopyOfSharedPlan(plan) : plan;
      const data =
        savedRevision === null || readOnlyShared
          ? await apiPost<{ plan: PlanDocumentV2 }>("/v2/plans", { plan: documentToSave })
          : await apiSend<{ plan: PlanDocumentV2 }>("PATCH", `/v2/plans/${plan.id}`, {
              plan: documentToSave,
              expectedRevision: savedRevision
            });
      setPlan(data.plan);
      setSavedRevision(data.plan.revision);
      setUndoStack([]);
      publishDocument(data.plan);
      if (readOnlyShared) {
        setSharedToken(null);
        setSharedPlanStatus("idle");
        const params = new URLSearchParams(window.location.search);
        params.set("mode", "planning");
        window.history.replaceState(window.history.state, "", `/?${params.toString()}`);
      }
      store.showToast(
        readOnlyShared ? "Vlastní kopie je uložená v Moje" : "Plán je uložený v Moje"
      );
      return data.plan;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Plán se nepodařilo uložit");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const loadShares = async (planId = plan.id) => {
    if (savedRevision === null || readOnlyShared || shareListLoading) return;
    setShareListLoading(true);
    try {
      const data = await apiGet<{ shares: PlanShareLink[] }>(
        `/v2/plans/${encodeURIComponent(planId)}/shares`,
        { auth: true }
      );
      // A user can create a link while the existing list is loading. Merge the late list response
      // so it cannot erase a freshly created link from the same surface.
      setShareLinks((current) => {
        const byId = new Map(current.map((share) => [share.id, share]));
        for (const share of data.shares) if (!byId.has(share.id)) byId.set(share.id, share);
        return [...byId.values()];
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Odkazy se nepodařilo načíst");
    } finally {
      setShareListLoading(false);
    }
  };

  const createShare = async () => {
    if (shareBusy || readOnlyShared) return;
    setShareBusy(true);
    setError(null);
    try {
      const persistedPlan = savedRevision === null ? await save() : plan;
      if (!persistedPlan) return;
      const data = await apiPost<{ share: PlanShareLink; token: string }>(
        `/v2/plans/${encodeURIComponent(persistedPlan.id)}/shares`,
        { permission: "view" }
      );
      const url = buildPlanShareUrl(window.location.origin, data.token);
      setNewShareUrl(url);
      setShareLinks((current) => [data.share, ...current]);
      try {
        await navigator.clipboard.writeText(url);
        store.showToast("Odkaz jen pro čtení je zkopírovaný");
      } catch {
        store.showToast("Odkaz je vytvořený; zkopíruj ho z pole");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Odkaz se nepodařilo vytvořit");
    } finally {
      setShareBusy(false);
    }
  };

  const copyShareUrl = async () => {
    if (!newShareUrl) return;
    try {
      await navigator.clipboard.writeText(newShareUrl);
      store.showToast("Odkaz je zkopírovaný");
    } catch {
      store.showToast("Odkaz se nepodařilo zkopírovat");
    }
  };

  const revokeShare = async (share: PlanShareLink) => {
    if (shareBusy || share.revokedAt) return;
    setShareBusy(true);
    setError(null);
    try {
      await apiSend<void>(
        "DELETE",
        `/v2/plans/${encodeURIComponent(plan.id)}/shares/${encodeURIComponent(share.id)}`
      );
      setShareLinks((current) =>
        current.map((candidate) =>
          candidate.id === share.id
            ? { ...candidate, revokedAt: new Date().toISOString() }
            : candidate
        )
      );
      if (newShareUrl) setNewShareUrl(null);
      store.showToast("Odkaz byl odvolán");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Odkaz se nepodařilo odvolat");
    } finally {
      setShareBusy(false);
    }
  };

  const exportPlan = async (format: "gpx" | "geojson" | "kml" | "mapos") => {
    setExporting(format);
    setError(null);
    try {
      const data = await apiPost<ExportResponse>(`/v2/plans/export/${format}`, { plan });
      triggerDownload(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Plán se nepodařilo exportovat");
    } finally {
      setExporting(null);
    }
  };

  const copyItinerary = async () => {
    try {
      await navigator.clipboard.writeText(buildPlanItinerary(plan));
      store.showToast("Itinerář je zkopírovaný");
    } catch {
      store.showToast("Itinerář se nepodařilo zkopírovat");
    }
  };

  const shareItinerary = async () => {
    const text = buildPlanItinerary(plan);
    try {
      if (navigator.share) {
        await navigator.share({ title: plan.name, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      store.showToast("Sdílený přehled je zkopírovaný");
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      store.showToast("Sdílení se nepodařilo");
    }
  };

  const discussPlan = async () => {
    const prompt = aiPlanPrompt.trim();
    if (!prompt || aiPlanBusy || aiThreadLoading || readOnlyShared) return;
    setAiPlanBusy(true);
    setAiPlanAnswer(null);
    setError(null);
    try {
      let persistedPlan = savedRevision === null ? null : plan;
      if (persistedPlan && plan.revision !== savedRevision) persistedPlan = await save();
      if (persistedPlan) {
        const existingThread = aiThread?.planId === persistedPlan.id ? aiThread : null;
        const response = await apiPost<{
          status: "succeeded";
          conversation: PlanDiscussionThread;
          answer: { text: string; model: string; cached: boolean; disclosure: string };
        }>(`/v2/ai/plans/${encodeURIComponent(persistedPlan.id)}/discussion`, {
          prompt,
          externalModelConsent: true,
          ...(existingThread
            ? {
                conversationId: existingThread.id,
                baseRevision: existingThread.revision
              }
            : {})
        });
        setAiThread(response.conversation);
        loadedThreadForPlan.current = persistedPlan.id;
      } else {
        const response = await apiPost<{
          status: "succeeded";
          answer: { text: string; model: string; cached: boolean; disclosure: string };
        }>("/v2/ai/plan-discuss", {
          prompt,
          plan,
          externalModelConsent: true
        });
        setAiPlanAnswer(response.answer);
      }
      setAiPlanPrompt("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI diskuse není dostupná");
    } finally {
      setAiPlanBusy(false);
    }
  };

  const startNewAiThread = () => {
    setAiThread(null);
    setAiPlanAnswer(null);
    loadedThreadForPlan.current = plan.id;
    store.showToast("Nová AI konverzace začne dalším dotazem");
  };

  const totals = summarizePlanSegments(plan);
  const temporalSegments = new Map(
    temporalContext?.segments.map((segment) => [segment.segmentId, segment]) ?? []
  );
  const externalHandoffs = buildExternalPlanHandoffs(plan);
  const showVehicleLimits =
    plan.routePolicy.profile === "camper" || plan.routePolicy.profile === "truck";
  const routeMapping = resolvePlanRoutingRequestV2(
    provider,
    plan.routePolicy.profile,
    plan.routePolicy.preference,
    plan.routePolicy.avoid
  );
  const hasNativeMapping =
    routeMapping.profileCapability === "native" && routeMapping.preferenceCapability === "native";
  const cyclingMapActive = Boolean(activeLayers.cyclosm?.visible);
  const currentBasemapLabel = basemapById(basemapId)?.label ?? basemapId;
  const visibleStops = plan.stops.slice(stopWindowStart, stopWindowStart + STOP_WINDOW_SIZE);
  const stopWindowEnd = stopWindowStart + visibleStops.length;

  return (
    <PanelShell
      title={t("mode.planning")}
      testId="planning-panel"
      className="planning-panel"
      // §21.2: a plan that already has stops or a route opens full on a phone; a blank form
      // opens half, so the map the user is about to pick from stays in view.
      hasContent={plan.stops.length > 2 || totals.ready > 0}
    >
      <div className="planner-stack">
        {readOnlyShared && (
          <div
            className={`planner-shared-banner status-${sharedPlanStatus}`}
            role="status"
            data-testid="shared-plan-banner"
          >
            <span aria-hidden="true">↗</span>
            <div>
              <strong>
                {sharedPlanStatus === "loading"
                  ? "Otevírám sdílený plán…"
                  : sharedPlanStatus === "error"
                    ? "Sdílený plán není dostupný"
                    : "Sdílený plán · jen pro čtení"}
              </strong>
              <small>
                Soukromé poznámky a AI konverzace vlastníka nejsou součástí odkazu. Pro úpravy si
                ulož vlastní kopii.
              </small>
            </div>
          </div>
        )}

        <fieldset className="planner-editor-scope" disabled={readOnlyShared}>
          <div className="planner-toolbar">
            <span>{loadingSavedPlan ? "Načítám uložený plán…" : `Revize ${plan.revision}`}</span>
            <button
              type="button"
              className="btn btn-ghost small"
              disabled={undoStack.length === 0}
              onClick={undo}
            >
              ↶ Vrátit
            </button>
          </div>

          <label className="planner-field">
            <span>Název plánu</span>
            <input
              data-testid="plan-name"
              value={plan.name}
              onChange={(event) =>
                applyCommand({ type: "update-plan", patch: { name: event.target.value } })
              }
            />
          </label>

          <details className="planner-more-options" data-testid="plan-more-options">
            <summary>Více možností</summary>
            <div className="planner-more-content">
              <div className="planner-grid two">
                <label className="planner-field">
                  <span>Datum odjezdu</span>
                  <input
                    type="datetime-local"
                    value={localDateTime(plan.departureAt)}
                    onChange={(event) =>
                      applyCommand({
                        type: "set-departure",
                        departureAt: event.target.value
                          ? new Date(event.target.value).toISOString()
                          : null
                      })
                    }
                  />
                </label>
                <label className="planner-field">
                  <span>Typ vozidla</span>
                  <select
                    value={plan.routePolicy.profile}
                    onChange={(event) => {
                      const profile = event.target.value as PlanTravelProfileV2;
                      applyCommand({
                        type: "replace-vehicle",
                        vehicle: { ...(plan.vehicle ?? { profile }), profile }
                      });
                      if (profile === "bike" && !bikeBasemapDismissed) {
                        store.showToast("Pro kolo je připravené doporučení CyclOSM");
                      }
                    }}
                  >
                    {Object.entries(PROFILE_LABELS).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {plan.routePolicy.profile === "bike" && (
                <section
                  className={`planner-bike-map ${cyclingMapActive ? "active" : ""}`}
                  data-testid="bike-basemap-recommendation"
                  aria-label="Doporučení cyklistického podkladu"
                >
                  <span className="planner-bike-map-icon" aria-hidden="true">
                    🚲
                  </span>
                  <div>
                    <strong>
                      {cyclingMapActive
                        ? "CyclOSM je na mapě aktivní"
                        : bikeBasemapDismissed
                          ? "Tvůj ruční podklad zůstává"
                          : "Doporučená cyklistická mapa"}
                    </strong>
                    <p>
                      {cyclingMapActive
                        ? `Cyklistické stezky a povrchy se kreslí nad podkladem ${currentBasemapLabel}.`
                        : bikeBasemapDismissed
                          ? `${currentBasemapLabel} jsme nepřepnuli. Doporučení můžeš kdykoli obnovit.`
                          : `CyclOSM přidá stezky, pruhy a povrchy nad ${currentBasemapLabel}; základní podklad nepřepíše.`}
                    </p>
                  </div>
                  <div className="planner-bike-map-actions">
                    {cyclingMapActive ? (
                      <button
                        type="button"
                        className="btn btn-ghost small"
                        onClick={() => store.toggleLayer("cyclosm")}
                      >
                        Vypnout CyclOSM
                      </button>
                    ) : bikeBasemapDismissed ? (
                      <button
                        type="button"
                        className="btn btn-ghost small"
                        onClick={() => {
                          window.localStorage.removeItem("mapos:bike-basemap-recommendation");
                          setBikeBasemapDismissed(false);
                        }}
                      >
                        Znovu nabídnout
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn-accent small"
                          data-testid="activate-bike-map"
                          onClick={() => {
                            store.toggleLayer("cyclosm");
                            store.showToast("CyclOSM je zapnutá; původní podklad zůstal zachovaný");
                          }}
                        >
                          Zapnout CyclOSM
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost small"
                          onClick={() => {
                            window.localStorage.setItem(
                              "mapos:bike-basemap-recommendation",
                              "dismissed"
                            );
                            setBikeBasemapDismissed(true);
                          }}
                        >
                          Ponechat můj podklad
                        </button>
                      </>
                    )}
                  </div>
                </section>
              )}

              {showVehicleLimits && (
                <div className="planner-grid three vehicle-limits">
                  {(["heightM", "widthM", "weightT"] as const).map((field) => (
                    <label className="planner-field" key={field}>
                      <span>
                        {field === "heightM"
                          ? "Výška m"
                          : field === "widthM"
                            ? "Šířka m"
                            : "Hmotnost t"}
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={plan.vehicle?.[field] ?? ""}
                        onChange={(event) =>
                          applyCommand({
                            type: "replace-vehicle",
                            vehicle: {
                              ...(plan.vehicle ?? { profile: plan.routePolicy.profile }),
                              [field]: event.target.value ? Number(event.target.value) : null
                            }
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}

              <fieldset className="planner-preferences">
                <legend>Profil trasy</legend>
                <div className="planner-preference-grid">
                  {(Object.keys(PREFERENCE_LABELS) as PlanRoutePreferenceV2[]).map((preference) => {
                    const mapping = resolvePlanRoutingRequestV2(
                      provider,
                      plan.routePolicy.profile,
                      preference,
                      plan.routePolicy.avoid
                    );
                    const native =
                      mapping.profileCapability === "native" &&
                      mapping.preferenceCapability === "native";
                    return (
                      <button
                        key={preference}
                        type="button"
                        className={plan.routePolicy.preference === preference ? "active" : ""}
                        data-support={native ? "native" : "fallback"}
                        aria-pressed={plan.routePolicy.preference === preference}
                        aria-describedby={
                          plan.routePolicy.preference === preference
                            ? "planner-route-capability"
                            : undefined
                        }
                        onClick={() =>
                          applyCommand({
                            type: "replace-route-policy",
                            routePolicy: { ...plan.routePolicy, preference }
                          })
                        }
                      >
                        <span>{PREFERENCE_LABELS[preference]}</span>
                        <small>{native ? "Podporováno" : "Fallback"}</small>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div
                id="planner-route-capability"
                className={`planner-capability ${hasNativeMapping ? "native" : "fallback"}`}
                role="status"
                aria-live="polite"
                data-testid="plan-route-mapping"
              >
                <strong>
                  {hasNativeMapping
                    ? "Provider tuto kombinaci podporuje"
                    : "Provider použije označený fallback"}
                </strong>
                <span>
                  Request: {provider} · profile={routeMapping.providerProfile} · preference=
                  {routeMapping.effectivePreference}
                </span>
                {routeMapping.warnings.map((warning) => (
                  <small key={warning}>{warning}</small>
                ))}
              </div>
            </div>
          </details>

          {plan.departureAt && (
            <section
              className="planner-temporal-context"
              data-testid="plan-temporal-context"
              aria-labelledby="plan-temporal-context-title"
              aria-busy={temporalContextStatus === "loading"}
            >
              <div className="planner-temporal-heading">
                <span className="planner-temporal-icon" aria-hidden="true">
                  ◷
                </span>
                <div>
                  <span>Kontext odjezdu</span>
                  <h3 id="plan-temporal-context-title">{formatPlanTime(plan.departureAt)}</h3>
                  <p>Časová osa mapy se po výpočtu nastaví na odjezd.</p>
                </div>
              </div>

              <div className="planner-temporal-switches">
                <label>
                  <input
                    type="checkbox"
                    checked={plan.routePolicy.weatherAlongRoute !== false}
                    onChange={(event) =>
                      applyCommand({
                        type: "replace-route-policy",
                        routePolicy: {
                          ...plan.routePolicy,
                          weatherAlongRoute: event.target.checked
                        }
                      })
                    }
                  />
                  Počasí podél trasy
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={plan.routePolicy.trafficAlongRoute !== false}
                    onChange={(event) =>
                      applyCommand({
                        type: "replace-route-policy",
                        routePolicy: {
                          ...plan.routePolicy,
                          trafficAlongRoute: event.target.checked
                        }
                      })
                    }
                  />
                  Dopravní kontext
                </label>
              </div>

              <div className="planner-temporal-status-grid">
                <article data-status={temporalContext?.weather.status ?? temporalContextStatus}>
                  <span aria-hidden="true">☁</span>
                  <div>
                    <strong>Počasí</strong>
                    {temporalContextStatus === "loading" ? (
                      <small>Načítám skutečnou předpověď…</small>
                    ) : temporalContext?.weather.status === "ready" ? (
                      <small>
                        {temporalContext.weather.sampledStops}/{temporalContext.weather.totalStops}{" "}
                        zastávek · {temporalContext.weather.source?.label}
                      </small>
                    ) : temporalContext?.weather.reason ? (
                      <small>{temporalContext.weather.reason}</small>
                    ) : (
                      <small>Připraví se s výpočtem trasy.</small>
                    )}
                  </div>
                </article>
                <article data-status={temporalContext?.traffic.status ?? temporalContextStatus}>
                  <span aria-hidden="true">⇥</span>
                  <div>
                    <strong>Doprava</strong>
                    {temporalContextStatus === "loading" ? (
                      <small>Ověřuji dostupnost provideru…</small>
                    ) : temporalContext?.traffic.status === "provider-aware" ? (
                      <small>{temporalContext.traffic.source?.label}</small>
                    ) : temporalContext?.traffic.reason ? (
                      <small>{temporalContext.traffic.reason}</small>
                    ) : (
                      <small>Připraví se s výpočtem trasy.</small>
                    )}
                  </div>
                </article>
              </div>

              {temporalContext?.weather.status === "ready" && (
                <button
                  type="button"
                  className="btn btn-ghost small planner-temporal-map-action"
                  onClick={() => {
                    if (!activeLayers.weather?.visible) store.toggleLayer("weather");
                    if (temporalContext.departureAt) {
                      store.setTimeCursor(temporalContext.departureAt, "preview");
                    }
                  }}
                >
                  {activeLayers.weather?.visible ? "Počasí je v mapě" : "Zobrazit počasí v mapě"}
                </button>
              )}
              {temporalContext && (
                <small className="planner-temporal-budget">
                  Datově úsporné: nejvýše {temporalContext.dataBudget.maxWeatherStops} zastávek ·{" "}
                  {temporalContext.dataBudget.upstreamWeatherRequests} dávka počasí · žádná
                  simulovaná doprava
                </small>
              )}
            </section>
          )}

          {plan.routePolicy.preference === "adventure" && (
            <section
              className="planner-adventure"
              data-testid="adventure-planner"
              aria-labelledby="adventure-planner-title"
              aria-busy={adventureBusy}
            >
              <div className="planner-adventure-heading">
                <span className="planner-adventure-icon" aria-hidden="true">
                  ◈
                </span>
                <div>
                  <span className="planner-adventure-eyebrow">Deterministický výběr · bez AI</span>
                  <h3 id="adventure-planner-title">Najít zajímavější cestu</h3>
                  <p>
                    Vybere skutečné OSM místo a ověří zajížďku stejným routovacím providerem jako
                    zbytek plánu.
                  </p>
                </div>
              </div>

              <div className="planner-adventure-controls">
                <div className="planner-adventure-limit" role="group" aria-label="Limit zajížďky">
                  <span>Max. zajížďka</span>
                  {[10, 15, 25].map((limit) => (
                    <button
                      type="button"
                      key={limit}
                      className={adventureDetourLimit === limit ? "active" : ""}
                      aria-pressed={adventureDetourLimit === limit}
                      onClick={() => {
                        setAdventureDetourLimit(limit);
                        setAdventureRecommendation(null);
                      }}
                    >
                      {limit} %
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-accent"
                  data-testid="find-adventure-route"
                  disabled={adventureBusy}
                  onClick={() => void findAdventureRoute()}
                >
                  {adventureBusy ? "Ověřuji zajížďky…" : "Najít místa"}
                </button>
              </div>

              {adventureRecommendation && (
                <div className="planner-adventure-results" data-testid="adventure-results">
                  <div className="planner-adventure-summary" role="status">
                    <div>
                      <strong>{adventureRecommendation.suggestions.length}</strong>
                      <span>vhodná místa</span>
                    </div>
                    <div>
                      <strong>
                        {adventureRecommendation.coverage.scannedSegments}/
                        {adventureRecommendation.coverage.totalSegments}
                      </strong>
                      <span>prohledaných úseků</span>
                    </div>
                    <div>
                      <strong>{adventureRecommendation.dataBudget.providerCalls}</strong>
                      <span>route ověření</span>
                    </div>
                  </div>

                  {adventureRecommendation.suggestions.length > 0 ? (
                    <>
                      <div className="planner-adventure-candidates">
                        {adventureRecommendation.suggestions.map((candidate, index) => (
                          <article
                            className="planner-adventure-candidate"
                            data-testid={`adventure-candidate-${index + 1}`}
                            key={candidate.id}
                          >
                            <div
                              className="planner-adventure-score"
                              aria-label={`Skóre ${candidate.score} ze 100`}
                            >
                              <strong>{candidate.score}</strong>
                              <span>/100</span>
                            </div>
                            <div className="planner-adventure-place">
                              <span>
                                Úsek {candidate.segmentIndex + 1} · {candidate.category}
                              </span>
                              <h4>{candidate.name}</h4>
                              <p>
                                +{formatDistance(candidate.detourM, units)} · +
                                {candidate.detourPercent.toFixed(1)} % oproti přímé trase
                              </p>
                              <div
                                className="planner-adventure-breakdown"
                                aria-label="Rozpad skóre"
                              >
                                <span>Zajímavost {candidate.scoreBreakdown.interest}</span>
                                <span>Efektivita {candidate.scoreBreakdown.detourEfficiency}</span>
                                <span>Zdroj {candidate.scoreBreakdown.sourceConfidence}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn btn-ghost small"
                              onClick={() => applyAdventureCandidates([candidate])}
                            >
                              Přidat
                            </button>
                          </article>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn btn-accent block"
                        data-testid="apply-adventure-route"
                        onClick={() =>
                          applyAdventureCandidates(adventureRecommendation.suggestions)
                        }
                      >
                        Přidat doporučená místa a přepočítat
                      </button>
                    </>
                  ) : (
                    <p className="planner-adventure-empty">
                      V limitu {adventureRecommendation.algorithm.detourLimitPercent} % není žádné
                      relevantní místo. Zkus vyšší limit nebo posuň zastávky.
                    </p>
                  )}

                  {adventureRecommendation.warnings.map((warning) => (
                    <p className="planner-warning" key={warning}>
                      {warning}
                    </p>
                  ))}
                  <details className="planner-adventure-method">
                    <summary>Jak vzniklo skóre</summary>
                    <p>{adventureRecommendation.algorithm.formula}.</p>
                    <small>
                      {adventureRecommendation.algorithm.version} · žádný náhodný waypoint · OSM ·
                      nejvýše {adventureRecommendation.dataBudget.maxRoutedCandidates} kandidátů a{" "}
                      {adventureRecommendation.dataBudget.maxReturnedSuggestions} výsledky
                    </small>
                  </details>
                </div>
              )}
            </section>
          )}

          <section className="planner-section">
            <div className="planner-section-title">
              <h3>Zastávky</h3>
              <span>{plan.stops.length} celkem · bez limitu provideru</span>
            </div>
            <div className="planner-stops">
              {visibleStops.map((stop, visibleIndex) => {
                const index = stopWindowStart + visibleIndex;
                return (
                  <div className="planner-stop" key={stop.id}>
                    <span className="planner-stop-index">{index + 1}</span>
                    <div className="planner-stop-fields">
                      <StopLocationInput
                        index={index + 1}
                        name={stop.name}
                        provider={provider}
                        aiEnabled={aiEnabled}
                        aiBusy={aiStopBusyId === stop.id}
                        onNameChange={(name) =>
                          applyCommand({ type: "update-stop", stopId: stop.id, patch: { name } })
                        }
                        onSelect={(selection) => selectStopLocation(stop.id, selection)}
                        onAiQuery={(prompt) => void runAiStopQuery(stop.id, prompt)}
                      />
                      <div className="planner-stop-location">
                        <span aria-label={`Souřadnice zastávky ${index + 1}`}>
                          {stop.location.coordinates[1].toFixed(5)},{" "}
                          {stop.location.coordinates[0].toFixed(5)}
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost small"
                          data-testid={`pick-stop-${index + 1}`}
                          onClick={() => pickStopLocation(stop, index)}
                        >
                          Vybrat na mapě
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost small"
                          data-testid={`locate-stop-${index + 1}`}
                          disabled={locatingStopId !== null}
                          onClick={() => void locateStop(stop.id, stop.name)}
                        >
                          {locatingStopId === stop.id ? "Zaměřuji…" : "Moje poloha"}
                        </button>
                      </div>
                      {locationFallback?.stopId === stop.id && (
                        <div
                          className={`planner-location-fallback kind-${locationFallback.kind}`}
                          data-testid={`location-fallback-${index + 1}`}
                          role="status"
                        >
                          <div className="planner-location-fallback-heading">
                            <span aria-hidden="true">⌖</span>
                            <div>
                              <strong>
                                {locationFallback.kind === "denied"
                                  ? "Poloha není povolená"
                                  : "GPS teď není dostupná"}
                              </strong>
                              <p>{locationFallback.message}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-accent small"
                            onClick={() => pickStopLocation(stop, index)}
                          >
                            Vybrat bod na mapě
                          </button>
                          <fieldset className="planner-location-manual">
                            <legend>Nebo zadej souřadnice ručně</legend>
                            <label>
                              <span>Délka</span>
                              <input
                                aria-label={`Ruční délka ${index + 1}`}
                                type="number"
                                step="0.0001"
                                value={Number(stop.location.coordinates[0].toFixed(6))}
                                onChange={(event) =>
                                  updateStopLocation(
                                    stop.id,
                                    Number(event.target.value),
                                    stop.location.coordinates[1]
                                  )
                                }
                              />
                            </label>
                            <label>
                              <span>Šířka</span>
                              <input
                                aria-label={`Ruční šířka ${index + 1}`}
                                type="number"
                                step="0.0001"
                                value={Number(stop.location.coordinates[1].toFixed(6))}
                                onChange={(event) =>
                                  updateStopLocation(
                                    stop.id,
                                    stop.location.coordinates[0],
                                    Number(event.target.value)
                                  )
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className="btn btn-ghost small"
                              onClick={() => {
                                setLocationFallback(null);
                                store.showToast(`Ruční poloha zastávky „${stop.name}“ je použitá`);
                              }}
                            >
                              Použít souřadnice
                            </button>
                          </fieldset>
                        </div>
                      )}
                      <details className="planner-stop-more">
                        <summary>Čas a přesné GPS</summary>
                        <div className="planner-coordinates">
                          <input
                            aria-label={`Délka ${index + 1}`}
                            type="number"
                            step="0.0001"
                            value={stop.location.coordinates[0]}
                            onChange={(event) =>
                              updateStopLocation(
                                stop.id,
                                Number(event.target.value),
                                stop.location.coordinates[1]
                              )
                            }
                          />
                          <input
                            aria-label={`Šířka ${index + 1}`}
                            type="number"
                            step="0.0001"
                            value={stop.location.coordinates[1]}
                            onChange={(event) =>
                              updateStopLocation(
                                stop.id,
                                stop.location.coordinates[0],
                                Number(event.target.value)
                              )
                            }
                          />
                          <input
                            aria-label={`Pobyt ${index + 1}`}
                            title="Pobyt v minutách"
                            type="number"
                            min="0"
                            value={stop.dwellMinutes}
                            onChange={(event) =>
                              applyCommand({
                                type: "update-stop",
                                stopId: stop.id,
                                patch: { dwellMinutes: Math.max(0, Number(event.target.value)) }
                              })
                            }
                          />
                        </div>
                      </details>
                      <div className="planner-stop-actions planner-stop-order">
                        <button
                          type="button"
                          className="btn btn-ghost small"
                          aria-label={`Posunout zastávku ${index + 1} nahoru`}
                          disabled={index === 0}
                          onClick={() =>
                            applyCommand({ type: "move-stop", stopId: stop.id, toIndex: index - 1 })
                          }
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost small"
                          aria-label={`Posunout zastávku ${index + 1} dolů`}
                          disabled={index === plan.stops.length - 1}
                          onClick={() =>
                            applyCommand({ type: "move-stop", stopId: stop.id, toIndex: index + 1 })
                          }
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="planner-remove"
                      aria-label={`Odebrat zastávku ${index + 1}`}
                      disabled={plan.stops.length <= 2}
                      onClick={() => applyCommand({ type: "remove-stop", stopId: stop.id })}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
            {plan.stops.length > STOP_WINDOW_SIZE && (
              <nav className="planner-stop-window" aria-label="Stránkování zastávek">
                <button
                  type="button"
                  className="btn btn-ghost small"
                  disabled={stopWindowStart === 0}
                  onClick={() =>
                    setStopWindowStart((current) => Math.max(0, current - STOP_WINDOW_SIZE))
                  }
                >
                  ← Předchozí
                </button>
                <span>
                  {stopWindowStart + 1}–{stopWindowEnd} z {plan.stops.length}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost small"
                  disabled={stopWindowEnd >= plan.stops.length}
                  onClick={() =>
                    setStopWindowStart((current) =>
                      Math.min(
                        current + STOP_WINDOW_SIZE,
                        Math.floor((plan.stops.length - 1) / STOP_WINDOW_SIZE) * STOP_WINDOW_SIZE
                      )
                    )
                  }
                >
                  Další →
                </button>
              </nav>
            )}
            <div className="planner-add-actions">
              <button type="button" className="btn" onClick={() => addStop()}>
                ＋ Přidat zastávku
              </button>
              <button
                type="button"
                className="btn btn-accent"
                data-testid="pick-new-stop"
                onClick={pickNewStop}
              >
                Vybrat z mapy
              </button>
            </div>
            {mapSuggestions.length > 0 && (
              <div className="planner-map-suggestion-block">
                <span>Rychle přidat z viditelných míst</span>
                <div className="planner-suggestions" aria-label="Viditelná místa pro plán">
                  {mapSuggestions.map(({ feature, layerId }) => (
                    <button
                      type="button"
                      key={`${layerId}:${String(feature.properties.id)}`}
                      onClick={() => addStop(feature)}
                    >
                      <span aria-hidden="true">＋</span>
                      <span>{String(feature.properties.name ?? "Místo na mapě")}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {aiStopAnswer && (
              <div className="planner-ai-results" data-testid="planner-ai-results" role="status">
                <div>
                  <strong>AI návrhy</strong>
                  <span>{aiStopAnswer.text}</span>
                </div>
                {aiStopAnswer.results.map((result) => (
                  <button
                    type="button"
                    key={result.id}
                    onClick={() =>
                      openAiStopCandidate(aiStopAnswer.stopId, aiStopAnswer.prompt, result)
                    }
                  >
                    <strong>{result.title}</strong>
                    <span>{Math.round(result.distanceMeters)} m</span>
                    <small>{result.source.label}</small>
                  </button>
                ))}
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => setAiStopAnswer(null)}
                >
                  Zavřít návrhy
                </button>
              </div>
            )}
          </section>

          {error && (
            <p className="planner-error" role="alert">
              {error}
            </p>
          )}

          <button
            className="btn btn-accent block"
            data-testid="calculate-plan"
            disabled={busy}
            onClick={() => void calculate()}
          >
            {busy ? "Počítám sousední úseky…" : "Vypočítat plán"}
          </button>

          <section className="planner-result" data-testid="planning-result">
            <div>
              <strong>{formatDistance(totals.distanceM, units)}</strong>
              <span>{formatDuration(totals.durationS)}</span>
            </div>
            <div>
              <strong>
                {totals.ready}/{plan.segments.length}
              </strong>
              <span>hotových úseků</span>
            </div>
            {totals.failed > 0 && (
              <p className="planner-warning danger" role="status">
                {totals.failed} úseků selhalo. Ostatní části plánu zůstávají dostupné.
              </p>
            )}
            {totals.stale > 0 && (
              <p className="planner-warning" role="status">
                {totals.stale} úseků čeká na přepočet.
              </p>
            )}
            {totals.ready > 0 && (
              <p className="planner-map-selection-hint">
                Trasa je složená ze skutečných úseků. Vyberte úsek tady nebo přímo v mapě; zvolená
                část se zvýrazní oranžově.
              </p>
            )}
            <div className="planner-segments" aria-label="Stav úseků plánu">
              {plan.segments.map((segment) => {
                const alternative = selectedPlanAlternative(segment);
                const recommended = segment.alternatives[0] ?? null;
                const selectedOnMap = selectedRouteSegmentId === segment.id;
                const temporalSegment = temporalSegments.get(segment.id);
                return (
                  <article
                    className={`planner-segment status-${segment.status}${selectedOnMap ? " selected-on-map" : ""}`}
                    key={segment.id}
                    data-testid={`plan-segment-${segment.order + 1}`}
                    data-route-segment-id={segment.id}
                    aria-current={selectedOnMap ? "true" : undefined}
                  >
                    <div className="planner-segment-head">
                      <span>{segment.order + 1}</span>
                      <div>
                        <strong>
                          {plan.stops[segment.order]?.name} → {plan.stops[segment.order + 1]?.name}
                        </strong>
                        <small>
                          {alternative
                            ? `${formatDistance(alternative.distanceM, units)} · ${formatDuration(alternative.durationS)}`
                            : segment.status === "failed"
                              ? "Výpočet selhal"
                              : "Čeká na výpočet"}
                        </small>
                      </div>
                      {segment.alternatives.length > 1 && (
                        <span className="planner-alternative-count">
                          {segment.alternatives.length} varianty
                        </span>
                      )}
                    </div>
                    {alternative && (
                      <button
                        type="button"
                        className="planner-segment-map-focus"
                        aria-pressed={selectedOnMap}
                        onClick={() => store.selectRouteSegment(selectedOnMap ? null : segment.id)}
                      >
                        {selectedOnMap ? "Vybráno v mapě" : "Zvýraznit v mapě"}
                      </button>
                    )}
                    {temporalSegment && (
                      <div
                        className="planner-segment-temporal"
                        data-testid={`segment-${segment.order + 1}-temporal`}
                      >
                        <span>
                          ◷ {formatPlanTime(temporalSegment.departureAt)} →{" "}
                          {formatPlanTime(temporalSegment.arrivalAt)}
                        </span>
                        <span>
                          {temporalSegment.weatherAtArrival
                            ? `☁ ${temporalSegment.weatherAtArrival.temperatureC?.toFixed(1) ?? "—"} °C · ${temporalSegment.weatherAtArrival.precipitationMm?.toFixed(1) ?? "—"} mm`
                            : "☁ Počasí bez dostupných dat"}
                        </span>
                        <span>
                          ⇥{" "}
                          {temporalSegment.trafficStatus === "provider-aware"
                            ? "provider zohlednil živou dopravu"
                            : temporalSegment.trafficStatus === "disabled"
                              ? "dopravní kontext vypnutý"
                              : "doprava pro tento čas bez dat"}
                        </span>
                        {temporalSegment.warnings.map((warning) => (
                          <strong key={warning}>⚠ {warning}</strong>
                        ))}
                      </div>
                    )}
                    {segment.alternatives.length > 1 && recommended && (
                      <div
                        className="planner-alternatives"
                        role="radiogroup"
                        aria-label={`Varianty úseku ${segment.order + 1}`}
                      >
                        {segment.alternatives.map((candidate, index) => {
                          const selected = candidate.id === segment.selectedAlternativeId;
                          return (
                            <button
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              className={selected ? "selected" : ""}
                              data-testid={`segment-${segment.order + 1}-alternative-${index + 1}`}
                              key={candidate.id}
                              onClick={() =>
                                applyCommand({
                                  type: "select-segment-alternative",
                                  segmentId: segment.id,
                                  alternativeId: candidate.id
                                })
                              }
                            >
                              <span>{index === 0 ? "Doporučená" : `Varianta ${index + 1}`}</span>
                              <strong>{formatDistance(candidate.distanceM, units)}</strong>
                              <span>{formatDuration(candidate.durationS)}</span>
                              <small>
                                {index === 0
                                  ? "výchozí volba provideru"
                                  : `${formatDistanceDelta(candidate.distanceM - recommended.distanceM, units)} · ${formatDurationDelta(candidate.durationS - recommended.durationS)}`}
                              </small>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </fieldset>

        <section className="planner-service-actions" aria-labelledby="planner-service-title">
          <div className="planner-section-title">
            <h3 id="planner-service-title">Uložit a sdílet</h3>
            <span>
              {readOnlyShared ? "otevřená kopie je jen pro čtení" : "plán zůstává editovatelný"}
            </span>
          </div>
          <div className="planner-primary-actions">
            <button
              className="btn btn-accent"
              data-testid="save-plan"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Ukládám…" : readOnlyShared ? "Uložit vlastní kopii" : "Uložit do Moje"}
            </button>
            <button
              className="btn"
              data-testid="share-plan-summary"
              onClick={() => void shareItinerary()}
            >
              Sdílet přehled
            </button>
            <button
              className="btn"
              data-testid="copy-plan-itinerary"
              onClick={() => void copyItinerary()}
            >
              Kopírovat itinerář
            </button>
          </div>

          {!readOnlyShared && (
            <details
              className="planner-share-manager"
              open={shareOpen}
              data-testid="plan-share-manager"
              onToggle={(event) => {
                const nextOpen = event.currentTarget.open;
                setShareOpen(nextOpen);
                if (nextOpen && savedRevision !== null && shareLinks.length === 0) {
                  void loadShares();
                }
              }}
            >
              <summary>
                <span aria-hidden="true">↗</span>
                <div>
                  <strong>Odkaz jen pro čtení</strong>
                  <small>Skutečný odvolatelný odkaz, ne jen zkopírovaný text</small>
                </div>
              </summary>
              <div className="planner-share-content">
                <p>
                  Každý s odkazem uvidí trasu a zastávky. Soukromé poznámky, identita a AI
                  konverzace se nikdy nesdílí.
                </p>
                <button
                  type="button"
                  className="btn btn-accent"
                  data-testid="create-plan-share"
                  disabled={shareBusy}
                  onClick={() => void createShare()}
                >
                  {shareBusy ? "Připravuji odkaz…" : "Vytvořit a zkopírovat odkaz"}
                </button>
                {shareListLoading && (
                  <p className="planner-share-loading" role="status">
                    Načítám dříve vytvořené odkazy…
                  </p>
                )}
                {newShareUrl && (
                  <div className="planner-share-url" data-testid="plan-share-url">
                    <label>
                      <span>Nový odkaz — po zavření už ho nelze znovu zobrazit</span>
                      <input
                        readOnly
                        value={newShareUrl}
                        onFocus={(event) => event.target.select()}
                      />
                    </label>
                    <button type="button" className="btn" onClick={() => void copyShareUrl()}>
                      Kopírovat
                    </button>
                  </div>
                )}
                {shareLinks.length > 0 && (
                  <ul className="planner-share-list" aria-label="Odkazy tohoto plánu">
                    {shareLinks.map((share) => (
                      <li key={share.id} className={share.revokedAt ? "revoked" : "active"}>
                        <div>
                          <strong>{share.revokedAt ? "Odvolaný odkaz" : "Aktivní odkaz"}</strong>
                          <small>
                            Jen pro čtení · vytvořen{" "}
                            {new Date(share.createdAt).toLocaleDateString("cs-CZ")}
                          </small>
                        </div>
                        {!share.revokedAt && (
                          <button
                            type="button"
                            className="btn btn-ghost small"
                            disabled={shareBusy}
                            onClick={() => void revokeShare(share)}
                          >
                            Odvolat
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          )}

          {aiEnabled && (
            <button
              type="button"
              className="planner-ai-toggle"
              aria-expanded={aiPlanOpen}
              aria-controls="planner-ai-discussion"
              data-testid="plan-ai-toggle"
              disabled={readOnlyShared}
              onClick={() => setAiPlanOpen((value) => !value)}
            >
              <span>AI</span>
              <strong>
                {readOnlyShared ? "AI po uložení vlastní kopie" : "Diskutovat tento plán"}
              </strong>
              <small>
                {readOnlyShared
                  ? "Konverzace vlastníka zůstává soukromá"
                  : aiPlanOpen
                    ? "Skrýt"
                    : savedRevision === null
                      ? "Jednorázový dotaz; uložený plán získá trvalé vlákno"
                      : "Otevřít uloženou konverzaci tohoto plánu"}
              </small>
            </button>
          )}
          {aiEnabled && aiPlanOpen && (
            <form
              id="planner-ai-discussion"
              className="planner-ai-discussion"
              data-testid="plan-ai-discussion"
              onSubmit={(event) => {
                event.preventDefault();
                void discussPlan();
              }}
            >
              {savedRevision !== null && (
                <div className="planner-ai-thread-head">
                  <div>
                    <strong>Uložená konverzace</strong>
                    <small>
                      {aiThread
                        ? `${aiThread.messageCount} zpráv · navazuje na tento plán`
                        : "Další dotaz založí nové vlákno u tohoto plánu"}
                    </small>
                  </div>
                  {aiThread && (
                    <button
                      type="button"
                      className="btn btn-ghost small"
                      onClick={startNewAiThread}
                    >
                      Nové vlákno
                    </button>
                  )}
                </div>
              )}
              {aiThreadLoading && <p className="planner-ai-thread-loading">Načítám konverzaci…</p>}
              {aiThread && aiThread.messages.length > 0 && (
                <div className="planner-ai-thread" data-testid="plan-ai-thread" aria-live="polite">
                  {aiThread.messages.map((message) => (
                    <article className={`role-${message.role}`} key={message.id}>
                      <strong>{message.role === "user" ? "Ty" : "MapOS AI"}</strong>
                      <p>{message.content}</p>
                      {message.role === "assistant" && message.disclosure && (
                        <small>{message.disclosure}</small>
                      )}
                    </article>
                  ))}
                </div>
              )}
              <label className="planner-field">
                <span>Co chceš s plánem probrat?</span>
                <textarea
                  rows={3}
                  maxLength={2_000}
                  value={aiPlanPrompt}
                  placeholder="Např. Který den je příliš dlouhý a kde by dávalo smysl udělat pauzu?"
                  onChange={(event) => setAiPlanPrompt(event.target.value)}
                />
              </label>
              <p className="planner-ai-consent">
                Odesláním sdílíš s nastaveným AI poskytovatelem text dotazu a omezený přehled: názvy
                a GPS zastávek, profil a souhrn úseků. Soukromé poznámky ani identita se neposílají.
                {aiThread
                  ? " AI dostane i omezenou historii tohoto vlákna, aby mohla navázat."
                  : ""}
                {savedRevision === null
                  ? " Tento jednorázový dotaz se neuloží; po uložení plánu bude vlákno trvalé."
                  : " Vlákno je uložené jen u tvého plánu."}{" "}
                AI plán sama nezmění.
              </p>
              <button
                className="btn btn-ai"
                type="submit"
                disabled={aiPlanBusy || aiThreadLoading || !aiPlanPrompt.trim()}
              >
                {aiPlanBusy
                  ? "AI zpracovává plán…"
                  : aiThreadLoading
                    ? "Načítám vlákno…"
                    : "Odeslat AI"}
              </button>
              {aiPlanAnswer && (
                <div className="planner-ai-plan-answer" role="status">
                  <strong>AI doporučení</strong>
                  <p>{aiPlanAnswer.text}</p>
                  <small>{aiPlanAnswer.disclosure}</small>
                </div>
              )}
            </form>
          )}

          <div className="planner-export-actions" aria-label="Exportovat plán">
            {(["gpx", "geojson", "kml", "mapos"] as const).map((format) => (
              <button
                key={format}
                className="btn btn-ghost"
                data-testid={`export-${format}`}
                disabled={exporting !== null}
                onClick={() => void exportPlan(format)}
              >
                {exporting === format ? "Exportuji…" : EXPORT_LABELS[format]}
              </button>
            ))}
          </div>
        </section>

        <section className="planner-handoff" aria-labelledby="planner-handoff-title">
          <div className="planner-section-title">
            <h3 id="planner-handoff-title">Otevřít trasu</h3>
            <span>externí mapy</span>
          </div>
          <div className="planner-handoff-links">
            {externalHandoffs.map((handoff) => (
              <a
                key={handoff.id}
                className="btn btn-ghost"
                data-testid={`handoff-${handoff.id}`}
                href={handoff.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {handoff.label}
              </a>
            ))}
          </div>
          {externalHandoffs.some((handoff) => handoff.limitation) && (
            <ul className="planner-handoff-limits" aria-label="Limity externích map">
              {externalHandoffs.flatMap((handoff) =>
                handoff.limitation ? (
                  <li key={handoff.id}>
                    <strong>{handoff.label}:</strong> {handoff.limitation}
                  </li>
                ) : (
                  []
                )
              )}
            </ul>
          )}
          <p className="planner-route-disclaimer">
            Trasu skládá MapOS po sousedních úsecích přes provider {provider}. Externí služba může
            profil, dopravní data i výslednou geometrii přepočítat odlišně.
          </p>
        </section>
      </div>
    </PanelShell>
  );
}
