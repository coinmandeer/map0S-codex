import { StopLocationInput } from "./planning/StopLocationInput";
import { Button } from "./kit/Button";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyPlanCommand,
  planV1ToV2,
  restorePlanSnapshot,
  type GeoFeature,
  type PlanCommandV2,
  type PlanDocumentV2,
  type PlanTemporalContextV2,
  type PlanTravelProfileV2,
  type Position,
  type TripPlan
} from "@mapos/layer-sdk";
import { detailMediaFromFeature } from "../info/detailModel";
import { apiGet, apiPost, apiSend } from "../lib/api";
import { t } from "../i18n";
import { buildExternalPlanHandoffs } from "../planning/externalHandoff";
import { buildPlanItinerary } from "../planning/planItinerary";
import { createBlankPlanDocument } from "../planning/planDraft";
import { askForStopCandidates } from "../planning/stopCandidates";
import {
  exportPlanDocument,
  PLAN_EXPORT_LABELS,
  type PlanExportFormat
} from "../planning/planExport";
import { buildPlanShareUrl, planShareTokenFromLocation } from "../planning/planSharing";
import {
  longestRoutablePreview,
  routableSegmentPreviews,
  summarizePlanSegments,
  unselectedAlternativePreviews
} from "../planning/planPresentation";
import { geolocation, GeolocationError, messageFor } from "../lib/geolocation";
import { emit, on } from "../lib/events";
import { isRoutingAbortError, startRoutingPlanTask } from "../planning/routingTask";
import { getMapStore } from "../store/mapStore";
import { getShellStore } from "../store/shellStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { PanelShell } from "./PanelShell";
import { InlineNotice, TextField, Select } from "./kit";
import { PlanAdventure } from "./planning/PlanAdventure";
import { PlanAssistant } from "./planning/PlanAssistant";
import { PlanFooter } from "./planning/PlanFooter";
import { PlanHeader } from "./planning/PlanHeader";
import { PlanOptions, PLAN_PROFILE_OPTIONS } from "./planning/PlanOptions";
import { PlanShareDialog, type PlanShareTab } from "./planning/PlanShareDialog";
import { PlanShareTools } from "./planning/PlanShareTools";
import { STOP_WINDOW_SIZE, StopList, type StopListHandlers } from "./planning/StopList";
import type { StopPlacePreview } from "./planning/StopRow";
import type { StopLocationSelection } from "./planning/StopLocationInput";
import type {
  AdventureCandidate,
  AdventureRecommendation,
  AiStopResult,
  PlanDiscussionThread,
  PlanShareLink,
  StopManualState
} from "./planning/types";

const MAX_UNDO_SNAPSHOTS = 50;

function localId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
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
    alternatives: unselectedAlternativePreviews(document).map((alternative) => ({
      ...alternative,
      coordinates: alternative.coordinates.map((position) => [...position] as [number, number])
    })),
    stops: document.stops.map((stop) => ({
      coordinates: [...stop.location.coordinates] as [number, number],
      order: stop.order + 1,
      name: stop.name
    }))
  };
}

/** The planning panel (§4.5).
 *
 *  The panel owns the document and every request; the pieces under `ui/planning/` are the
 *  presentation. Reading order is the order a trip is built: name, options, stops with the
 *  segments between them, then the sticky footer that computes and hands the route off.
 */
export function PlanningPanel() {
  const plan = useMapStoreSnapshot((s) => s.activePlan);
  const document = useMapStoreSnapshot((s) => s.activePlanDocument);
  const shared = planShareTokenFromLocation(window.location.pathname, window.location.hash);
  const store = getMapStore();
  const session = useMapStoreSnapshot((state) => state.session);
  const open = useMapStoreSnapshot((state) => state.sidebarOpen);
  const mode = useMapStoreSnapshot((state) => state.mode);
  const loadedPlansForOwner = useRef<string | null>(null);
  const draftEdits = useRef(0);
  const [loadingSavedPlan, setLoadingSavedPlan] = useState(false);
  useEffect(() => {
    const ownerId = session?.id;
    if (
      !open ||
      mode !== "planning" ||
      !ownerId ||
      shared ||
      document ||
      loadedPlansForOwner.current === ownerId
    ) {
      setLoadingSavedPlan(false);
      return;
    }
    loadedPlansForOwner.current = ownerId;
    let cancelled = false;
    const editVersion = draftEdits.current;
    setLoadingSavedPlan(true);
    void apiGet<{ plans: PlanDocumentV2[] }>("/v2/plans", { auth: true })
      .then(({ plans }) => {
        const latest = plans[0];
        // A local edit made while the request was in flight always wins over server hydration.
        if (cancelled || !latest || store.activePlanDocument || draftEdits.current !== editVersion)
          return;
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
  }, [document, mode, open, session?.id, shared, store]);
  if (!shared && !document && (!plan || plan.stops.length < 2))
    return (
      <EmptyPlanningPanel
        key={plan?.id ?? "empty"}
        seed={plan}
        onEdit={() => {
          draftEdits.current++;
          setLoadingSavedPlan(false);
        }}
      />
    );
  return <PlanningEditor loadingSavedPlan={loadingSavedPlan} />;
}

function EmptyPlanningPanel({ seed, onEdit }: { seed: TripPlan | null; onEdit(): void }) {
  const store = getMapStore();
  const provider = useMapStoreSnapshot((s) => s.dataProvider);
  const [points, setPoints] = useState<Array<StopLocationSelection | null>>([
    seed?.stops[0] ?? null,
    null
  ]);
  const [names, setNames] = useState([seed?.stops[0]?.name ?? "", ""]);
  const [profile, setProfile] = useState<PlanTravelProfileV2>("car");
  const [variant, setVariant] = useState<TripPlan["variant"]>("fast");
  const [locationError, setLocationError] = useState<string | null>(null);
  const choose = (index: number, point: StopLocationSelection) => {
    onEdit();
    const next = [...points];
    next[index] = point;
    setPoints(next);
    setNames((old) => old.map((name, i) => (i === index ? point.name : name)));
    if (next.every(Boolean))
      store.setActivePlanDocument({
        ...planV1ToV2({
          id: seed?.id ?? localId("plan"),
          name: "Nová cesta",
          departureAt: new Date().toISOString(),
          variant,
          visibility: "private",
          vehicle: { profile },
          stops: next.map((point) => ({ ...point!, id: localId("stop"), dwellMinutes: 0 }))
        }),
        departureAt: null
      });
  };
  const pick = (index: number) => {
    const view = store.view;
    getShellStore().startMapPicker(
      {
        caller: {
          id: `planning-endpoint-${index}`,
          label: index === 0 ? "Vyber start" : "Vyber cíl"
        },
        cancelPolicy: "restore-original-view",
        originalView: { center: { lng: view.lng, lat: view.lat }, zoom: view.zoom }
      },
      (result) => {
        if (result.status === "confirmed")
          choose(index, {
            name: result.location.label ?? "Místo na mapě",
            lng: result.location.lng,
            lat: result.location.lat
          });
      }
    );
  };
  const locate = async (index: number) => {
    setLocationError(null);
    try {
      const p = await geolocation.getPosition();
      choose(index, { ...p, name: "Moje poloha" });
    } catch (error) {
      setLocationError(messageFor(error));
    }
  };
  return (
    <PanelShell title="Plánování" testId="planning-panel">
      <div
        className="planner-empty"
        onInput={onEdit}
        style={{ padding: 16, display: "grid", gap: 16 }}
      >
        <p>Kam vyrazíme? Vyber start a cíl, nebo přidej místo z mapy.</p>
        <Select
          label="Doprava"
          options={PLAN_PROFILE_OPTIONS}
          value={profile}
          onChange={setProfile}
        />
        <Select
          label="Preference trasy"
          value={variant}
          onChange={setVariant}
          options={[
            { value: "fast", label: "Rychlá" },
            { value: "short", label: "Krátká" },
            { value: "nohwy", label: "Bez poplatků" }
          ]}
        />
        {names.map((name, index) => (
          <div key={index}>
            <label>
              {index === 0 ? "Odkud" : "Kam"}
              <StopLocationInput
                index={index + 1}
                name={name}
                provider={provider}
                aiEnabled={false}
                aiBusy={false}
                onNameChange={(value) => {
                  setNames((old) => old.map((n, i) => (i === index ? value : n)));
                  setPoints((old) => old.map((p, i) => (i === index ? null : p)));
                }}
                onSelect={(point) => choose(index, point)}
                onAiQuery={() => {}}
              />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Button variant="outlined" size="sm" onClick={() => pick(index)}>
                Vybrat na mapě
              </Button>
              <Button variant="tonal" size="sm" onClick={() => void locate(index)}>
                Moje poloha
              </Button>
            </div>
          </div>
        ))}
        {locationError && <p role="alert">{locationError}</p>}
        <Button variant="filled" block disabled>
          Vypočítat trasu
        </Button>
        <small>Nejdříve potvrď start a cíl.</small>
      </div>
    </PanelShell>
  );
}

function PlanningEditor({ loadingSavedPlan }: { loadingSavedPlan: boolean }) {
  const store = getMapStore();
  const shell = getShellStore();
  const open = useMapStoreSnapshot((state) => state.sidebarOpen);
  const mode = useMapStoreSnapshot((state) => state.mode);
  const view = useMapStoreSnapshot((state) => state.view);
  const activePlan = useMapStoreSnapshot((state) => state.activePlan);
  const activeDocument = useMapStoreSnapshot((state) => state.activePlanDocument);
  const selectedRouteSegmentId = useMapStoreSnapshot((state) => state.selectedRouteSegmentId);
  const provider = useMapStoreSnapshot((state) => state.dataProvider);
  const activeLayers = useMapStoreSnapshot((state) => state.activeLayers);
  const visibleFeatures = useMapStoreSnapshot((state) => state.visibleFeatures);
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
  const [shareTab, setShareTab] = useState<PlanShareTab | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareListLoading, setShareListLoading] = useState(false);
  const [shareLoadedForPlan, setShareLoadedForPlan] = useState<string | null>(null);
  const [shareLinks, setShareLinks] = useState<PlanShareLink[]>([]);
  const [newShareUrl, setNewShareUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [locatingStopId, setLocatingStopId] = useState<string | null>(null);
  const [manual, setManual] = useState<StopManualState | null>(null);
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
  const [adventureDetourLimit, setAdventureDetourLimit] = useState(15);
  const [adventureBusy, setAdventureBusy] = useState(false);
  const [adventureRecommendation, setAdventureRecommendation] =
    useState<AdventureRecommendation | null>(null);
  const [temporalContext, setTemporalContext] = useState<PlanTemporalContextV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastPublishedDocument = useRef<PlanDocumentV2 | null>(null);
  const planRef = useRef(plan);
  const loadedThreadForPlan = useRef<string | null>(null);
  const cancelRouting = useRef<(() => boolean) | null>(null);
  const pickAlternative = useRef<((segmentId: string, alternativeId: string) => void) | null>(null);
  const _mapSuggestions = useMemo(() => {
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
        if (suggestions.length >= 8) return suggestions;
      }
    }
    return suggestions;
  }, [activeLayers, visibleFeatures]);

  /**
   * The place each stop came from, when the map still has the pin.
   *
   * Best effort by design: the plan stores only `sourceFeatureId`, so once the pin is out of the
   * viewport the row falls back to its editable name. That is better than caching a photo URL
   * into the document, which would go stale and travel with every export.
   */
  const stopPlaces = useMemo(() => {
    const wanted = new Set(
      plan.stops.map((stop) => stop.sourceFeatureId).filter((id): id is string => Boolean(id))
    );
    const places = new Map<string, StopPlacePreview>();
    if (!wanted.size) return places;
    for (const features of Object.values(visibleFeatures)) {
      for (const feature of features ?? []) {
        const id = String(feature.properties.id ?? "");
        if (!wanted.has(id) || places.has(id)) continue;
        const name = String(feature.properties.name ?? "").trim();
        const [asset] = detailMediaFromFeature(feature);
        const photoUrl = asset?.thumbnailUrl ?? asset?.url;
        if (!name && !photoUrl) continue;
        places.set(id, { name: name || "Místo na mapě", ...(photoUrl ? { photoUrl } : {}) });
      }
    }
    return places;
  }, [plan.stops, visibleFeatures]);

  useEffect(() => {
    if (!selectedRouteSegmentId) return;
    const selectedRow = Array.from(
      document.querySelectorAll<HTMLElement>("[data-route-segment-id]")
    ).find((element) => element.dataset.routeSegmentId === selectedRouteSegmentId);
    selectedRow?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedRouteSegmentId]);

  const publishDocument = (document: PlanDocumentV2) => {
    // Follow-up routing may start in this event, before React renders the edited document.
    planRef.current = document;
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

  // §16.6: clicking a dimmed variant on the map is the same edit as picking it in the itinerary.
  // The map knows nothing about the document, so the panel answers through the handler it last
  // rendered with; a closed panel leaves the ref empty and the click only highlights.
  useEffect(
    () =>
      on("plan-alternative-picked", ({ segmentId, alternativeId }) => {
        pickAlternative.current?.(segmentId, alternativeId);
      }),
    []
  );

  if (!open || mode !== "planning") {
    pickAlternative.current = null;
    return null;
  }

  const readOnlyShared = sharedToken !== null;
  // Asynchronous work (a reverse geocode, a routing answer) has to write against the document
  // as it is when the answer lands, so the latest one is kept where a stale closure can find it.
  planRef.current = plan;

  const remember = (document: PlanDocumentV2) => {
    setUndoStack((current) => [...current.slice(-(MAX_UNDO_SNAPSHOTS - 1)), document]);
  };

  /**
   * Weather and traffic along the route, and the departure they need.
   *
   * The switch used to be disabled until a date was set, which meant the feature was invisible
   * to anyone who had not already gone looking for the date field. Turning it on now dates the
   * plan at "now"; turning it off leaves the plan undated again, so the timeline goes away with
   * the thing that needed it.
   */
  const toggleRouteContext = (next: boolean) => {
    const withPolicy = applyCommand({
      type: "replace-route-policy",
      routePolicy: {
        ...plan.routePolicy,
        weatherAlongRoute: next,
        trafficAlongRoute: next
      }
    });
    if (!withPolicy) return;
    if (next === Boolean(withPolicy.departureAt)) return;
    applyCommandTo(withPolicy, {
      type: "set-departure",
      departureAt: next ? new Date().toISOString() : null
    });
  };

  const applyCommandTo = (
    document: PlanDocumentV2,
    command: PlanCommandV2
  ): PlanDocumentV2 | null => {
    setError(null);
    try {
      const result = applyPlanCommand(document, {
        id: localId("command"),
        expectedRevision: document.revision,
        command
      });
      remember(result.undoDocument);
      setPlan(result.plan);
      publishDocument(result.plan);
      updatePreview(result.plan);
      setTemporalContext(null);
      return result.plan;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Změnu plánu nelze použít");
      return null;
    }
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
      // The map must not keep drawing legs the command just invalidated — a drag reorder, a
      // moved stop or a new stop all change which pairs still have geometry.
      updatePreview(result.plan);
      if (command.type !== "select-segment-alternative") setAdventureRecommendation(null);
      if (
        command.type !== "update-plan" &&
        command.type !== "upsert-annotation" &&
        command.type !== "remove-annotation"
      ) {
        setTemporalContext(null);
      }
      return result.plan;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Změnu plánu nelze použít");
      return null;
    }
  };

  pickAlternative.current = readOnlyShared
    ? null
    : (segmentId, alternativeId) =>
        void applyCommand({ type: "select-segment-alternative", segmentId, alternativeId });

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

  const startNewPlan = () => {
    const blank = createBlankPlanDocument(view.lng, view.lat);
    setPlan(blank);
    setSavedRevision(null);
    setUndoStack([]);
    setAiThread(null);
    setAiPlanAnswer(null);
    setShareLinks([]);
    setNewShareUrl(null);
    setTemporalContext(null);
    loadedThreadForPlan.current = null;
    publishDocument(blank);
    store.setRoutePreview(null, false);
    store.showToast("Nový plán je připravený");
  };

  const duplicatePlan = () => {
    const copy = {
      ...editableCopyOfSharedPlan(plan),
      name: `${plan.name} (kopie)`,
      revision: 1
    };
    setPlan(copy);
    setSavedRevision(null);
    setUndoStack([]);
    setAiThread(null);
    setShareLinks([]);
    setNewShareUrl(null);
    loadedThreadForPlan.current = null;
    publishDocument(copy);
    store.showToast("Kopie plánu je otevřená");
  };

  const stopAt = (stopId: string) => {
    const index = plan.stops.findIndex((candidate) => candidate.id === stopId);
    return index < 0 ? null : { stop: plan.stops[index]!, index };
  };

  const addStop = (feature?: GeoFeature): PlanDocumentV2 | null => {
    const coordinates = feature?.geometry.coordinates ?? [view.lng, view.lat];
    const insertIndex = plan.stops.length === 1 ? 1 : plan.stops.length - 1;
    const next = applyCommand({
      type: "add-stop",
      index: insertIndex,
      stop: {
        id: localId("stop"),
        name: String(feature?.properties.name ?? `Zastávka ${plan.stops.length}`),
        location: { type: "Point", coordinates: [...coordinates] as Position },
        sourceFeatureId: feature ? String(feature.properties.id) : null,
        // Planning is about places and the road between them; a dwell time turns the plan into
        // a schedule, and nobody asked for one.
        dwellMinutes: 0,
        status: "accepted"
      }
    });
    if (next) setStopWindowStart(Math.floor(insertIndex / STOP_WINDOW_SIZE) * STOP_WINDOW_SIZE);
    return next;
  };

  /**
   * Fills a picked stop's name from the geocoder, without blocking the pick on it.
   *
   * The rename lands on whatever the document looks like when the answer arrives, not on the
   * copy this closure was created with — otherwise it replays an old document and quietly
   * undoes the coordinate the pick had just written.
   */
  const nameStopFromLocation = async (stopId: string, lng: number, lat: number) => {
    try {
      const answer = await apiGet<{ name?: string | null }>("/geocode/reverse", {
        query: { lng: String(lng), lat: String(lat) }
      });
      const name = answer?.name?.trim();
      const current = planRef.current;
      if (!name || !current.stops.some((stop) => stop.id === stopId)) return;
      applyCommandTo(current, { type: "update-stop", stopId, patch: { name } });
    } catch {
      // A stop named by its coordinates is still a usable stop.
    }
  };

  const updateStopLocation = (stopId: string, lng: number, lat: number) => {
    applyCommand({
      type: "update-stop",
      stopId,
      patch: { location: { type: "Point", coordinates: [lng, lat] } }
    });
  };

  const selectStopLocation = (stopId: string, selection: StopLocationSelection) => {
    if (manual?.stopId === stopId) setManual(null);
    applyCommand({
      type: "update-stop",
      stopId,
      patch: {
        name: selection.name,
        location: { type: "Point", coordinates: [selection.lng, selection.lat] }
      }
    });
  };

  const pickStopLocation = (stopId: string) => {
    const target = stopAt(stopId);
    if (!target) return;
    const { stop, index } = target;
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
        if (manual?.stopId === stop.id) setManual(null);
        updateStopLocation(stop.id, result.location.lng, result.location.lat);
        store.showToast(`Poloha „${stop.name}“ byla změněna`);
        // The coordinate is already in the plan; the name catches up when the geocoder answers,
        // so the row never waits on the network to show that the tap registered.
        if (!result.location.label) {
          void nameStopFromLocation(stop.id, result.location.lng, result.location.lat);
        }
      }
    );
    if (Math.abs(lng - view.lng) > 0.000_001 || Math.abs(lat - view.lat) > 0.000_001) {
      emit("fly-to", { lng, lat, zoom: Math.max(view.zoom, 14) });
    }
  };

  const locateStop = async (stopId: string) => {
    const target = stopAt(stopId);
    if (!target) return;
    setLocatingStopId(stopId);
    setManual(null);
    setError(null);
    try {
      const fix = await geolocation.locate(undefined, { timeoutMs: 10_000 });
      updateStopLocation(stopId, fix.lng, fix.lat);
      emit("fly-to", { lng: fix.lng, lat: fix.lat, zoom: Math.max(view.zoom, 15) });
      store.showToast(`„${target.stop.name}“ používá tvoji polohu`);
    } catch (cause) {
      const denied = cause instanceof GeolocationError && cause.kind === "denied";
      setManual({
        stopId,
        reason: denied ? "denied" : "unavailable",
        message: messageFor(cause)
      });
    } finally {
      setLocatingStopId(null);
    }
  };

  const closeManual = () => {
    const name = manual ? stopAt(manual.stopId)?.stop.name : null;
    setManual(null);
    if (name) store.showToast(`Ruční poloha zastávky „${name}“ je použitá`);
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
        const named = addStop({
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
        if (!result.location.label && named) {
          const added = named.stops.find(
            (candidate) =>
              candidate.location.coordinates[0] === result.location.lng &&
              candidate.location.coordinates[1] === result.location.lat
          );
          if (added) {
            void nameStopFromLocation(added.id, result.location.lng, result.location.lat);
          }
        }
      }
    );
  };

  /**
   * The pin, the suggestions and one confirmation (§4.5).
   *
   * All candidates travel into the picker session, so the popover next to the pin can offer them
   * and a click moves the pin instead of writing to the plan. Only "Vybrat místo" writes, and it
   * writes the name of the suggestion the pin is standing on — not the query the user typed.
   */
  const openAiStopCandidate = (
    stopId: string,
    prompt: string,
    result: AiStopResult,
    alternatives: readonly AiStopResult[] = []
  ) => {
    const offered = [result, ...alternatives.filter((entry) => entry.id !== result.id)].slice(0, 5);
    shell.startMapPicker(
      {
        caller: {
          id: `planning-ai-stop-${stopId}`,
          label: "Potvrď AI návrh zastávky",
          context: result.title
        },
        cancelPolicy: "restore-original-view",
        originalView: { center: { lng: view.lng, lat: view.lat }, zoom: view.zoom },
        candidate: { lng: result.longitude, lat: result.latitude, label: result.title },
        suggestions: offered.map((entry) => ({
          lng: entry.longitude,
          lat: entry.latitude,
          label: entry.title
        }))
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

  /**
   * An open question in a stop input, answered without leaving Plánování (§4.5).
   *
   * The chat endpoint is used because it infers the category from the question — the orchestrator
   * only knows one — and because its deterministic path answers from the same POI tool even when
   * no model is available. Nothing is written: the answer becomes pin suggestions to confirm.
   */
  const runAiStopQuery = async (stopId: string, prompt: string) => {
    const stop = plan.stops.find((candidate) => candidate.id === stopId);
    if (!stop || aiStopBusyId) return;
    const visibleLayerIds = Object.entries(activeLayers)
      .filter(([, state]) => state.visible)
      .map(([id]) => id);
    const activeLayerIds = [...new Set(["osm-poi", ...visibleLayerIds])].slice(0, 20);
    setAiStopBusyId(stopId);
    setAiStopAnswer(null);
    setError(null);
    try {
      const [longitude, latitude] = stop.location.coordinates;
      const answer = await askForStopCandidates({
        prompt,
        longitude,
        latitude,
        zoom: view.zoom,
        activeLayerIds,
        planId: plan.id,
        externalModel: aiEnabled
      });
      if (!answer.results.length) {
        setError("AI k tomuhle dotazu nenašla místo; zkus jiný popis nebo výběr na mapě.");
        return;
      }
      setAiStopAnswer({ stopId, prompt, text: answer.text, results: answer.results });
      // The answer names the layers it read; switching them on is what makes the pin checkable.
      for (const layerId of answer.layerIds) {
        if (activeLayers[layerId] && !activeLayers[layerId]?.visible) store.toggleLayer(layerId);
      }
      const [first, ...rest] = answer.results;
      if (first) openAiStopCandidate(stopId, prompt, first, rest);
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

  const findAdventureRoute = async (document: PlanDocumentV2 = plan) => {
    if (document.routePolicy.preference !== "adventure" || adventureBusy) return;
    setAdventureBusy(true);
    setAdventureRecommendation(null);
    setError(null);
    try {
      const response = await apiPost<AdventureRecommendation>("/v2/routing/adventure", {
        plan: document,
        provider,
        detourLimitPercent: adventureDetourLimit,
        maximumSuggestions: 3
      });
      setAdventureRecommendation(response);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Dobrodružnou trasu se nepodařilo připravit"
      );
    } finally {
      setAdventureBusy(false);
    }
  };

  const offerProfileOverlay = (profile: PlanTravelProfileV2) => {
    if (profile !== "bike" && profile !== "foot") return;
    store.showToast(
      profile === "bike"
        ? "Cyklistickou trasu můžete doplnit značenými cyklotrasami"
        : "Trasu můžete doplnit turistickým značením",
      {
        action: {
          label: profile === "bike" ? "Zobrazit cyklotrasy" : "Zobrazit turistické trasy",
          onSelect: () => {
            store.setLayerFilters("waymarked-trails", {
              activity: profile === "bike" ? "cycling" : "hiking"
            });
            if (!store.activeLayers["waymarked-trails"]?.visible)
              store.toggleLayer("waymarked-trails");
          }
        }
      }
    );
  };

  const calculate = async (document: PlanDocumentV2 = plan) => {
    if (document.stops.length < 2) {
      setError("Přidejte cíl nebo další zastávku.");
      return;
    }
    setBusy(true);
    setError(null);
    setTemporalContext(null);
    cancelRouting.current?.();
    const sourcePlan = planRef.current;
    const run = startRoutingPlanTask(document, provider);
    cancelRouting.current = run.cancel;
    try {
      const data = await run.result;
      if (planRef.current !== sourcePlan || cancelRouting.current !== run.cancel) return;
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
        } catch {
          // Context is an extra on top of the route; a failure here must not fail the plan.
        }
      }
      if (data.failedSegmentIds.length) {
        store.showToast(
          `${data.failedSegmentIds.length} úseků se nepodařilo spočítat; ostatní zůstaly dostupné`
        );
      }
      // §29.3: the detour finder is part of the Dobrodružná profile, not a section the user
      // has to discover and trigger.
      if (data.plan.routePolicy.preference === "adventure") {
        void findAdventureRoute(data.plan);
      }
      offerProfileOverlay(data.plan.routePolicy.profile);
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
    if (plan.stops.length < 2) {
      setError("Před uložením plánu přidejte cíl. Jednotlivé místo můžete uložit z jeho detailu.");
      return null;
    }
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

  const openShareDialog = (tab: PlanShareTab) => {
    setShareTab(tab);
    // The link list is only worth a request once the dialog is on screen, and only for a plan
    // that already exists on the server.
    if (savedRevision !== null && shareLoadedForPlan !== plan.id) {
      setShareLoadedForPlan(plan.id);
      void loadShares();
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

  const exportPlan = async (format: PlanExportFormat) => {
    setExporting(format);
    setError(null);
    try {
      await exportPlanDocument(plan, format);
      setShareTab(null);
      store.showToast(`Plán je uložený jako ${PLAN_EXPORT_LABELS[format]}`);
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

  const segmentSummary = summarizePlanSegments(plan);
  const totals = { ...segmentSummary, total: plan.segments.length };
  const temporalSegments = new Map(
    temporalContext?.segments.map((segment) => [segment.segmentId, segment]) ?? []
  );
  const temporalContextNotes = temporalContext
    ? [
        temporalContext.weather.status === "ready"
          ? `Počasí: ${temporalContext.weather.sampledStops}/${temporalContext.weather.totalStops} zastávek · ${temporalContext.weather.source?.label ?? "neuvedený zdroj"}`
          : `Počasí: ${temporalContext.weather.reason ?? "bez dostupných dat"}`,
        temporalContext.traffic.status === "provider-aware"
          ? `Doprava: ${temporalContext.traffic.source?.label ?? "provider zohlednil živou dopravu"}`
          : `Doprava: ${temporalContext.traffic.reason ?? "bez dostupných dat"}`
      ]
    : [];
  const externalHandoffs = buildExternalPlanHandoffs(plan);

  const stopHandlers: StopListHandlers = {
    onNameChange: (stopId, name) => applyCommand({ type: "update-stop", stopId, patch: { name } }),
    onSelect: selectStopLocation,
    onAiQuery: (stopId, prompt) => void runAiStopQuery(stopId, prompt),
    onPick: pickStopLocation,
    onLocate: (stopId) => void locateStop(stopId),
    onManual: (stopId) => setManual({ stopId, reason: "manual" }),
    onManualClose: closeManual,
    onCoordinateChange: updateStopLocation,
    onMove: (stopId, toIndex) => applyCommand({ type: "move-stop", stopId, toIndex }),
    onRemove: (stopId) => applyCommand({ type: "remove-stop", stopId }),
    onDwellChange: (stopId, dwellMinutes) =>
      applyCommand({ type: "update-stop", stopId, patch: { dwellMinutes } }),
    onAdd: addStop,
    onPickNew: pickNewStop,
    onToggleMapSelection: (segmentId) => store.selectRouteSegment(segmentId),
    onSelectAlternative: (segmentId, alternativeId) =>
      applyCommand({ type: "select-segment-alternative", segmentId, alternativeId })
  };

  return (
    <PanelShell
      title={t("mode.planning")}
      testId="planning-panel"
      className="planning-panel"
      busy={loadingSavedPlan || sharedPlanStatus === "loading"}
      busyLabel="Načítám plán"
      // §21.2: a plan that already has stops or a route opens full on a phone; a blank form
      // opens half, so the map the user is about to pick from stays in view.
      hasContent={plan.stops.length > 2 || totals.ready > 0}
      headerExtra={
        <PlanHeader
          revision={plan.revision}
          canUndo={undoStack.length > 0}
          aiEnabled={aiEnabled}
          aiOpen={aiPlanOpen}
          readOnlyShared={readOnlyShared}
          onToggleAi={() => setAiPlanOpen((value) => !value)}
          onNewPlan={startNewPlan}
          onDuplicate={duplicatePlan}
          onUndo={undo}
        />
      }
      footer={
        <PlanFooter
          totals={totals}
          units={units}
          busy={busy}
          saving={saving}
          readOnlyShared={readOnlyShared}
          onCalculate={() => void calculate()}
          onSave={() => void save()}
          onOpenShare={openShareDialog}
        />
      }
    >
      <div className="planner-stack">
        {readOnlyShared && (
          <InlineNotice
            tone={sharedPlanStatus === "error" ? "danger" : "info"}
            testId="shared-plan-banner"
          >
            {sharedPlanStatus === "loading"
              ? "Otevírám sdílený plán…"
              : sharedPlanStatus === "error"
                ? "Sdílený plán není dostupný"
                : "Sdílený plán · jen pro čtení. Soukromé poznámky a AI konverzace vlastníka nejsou součástí odkazu; pro úpravy si ulož vlastní kopii."}
          </InlineNotice>
        )}

        <TextField
          label="Název plánu"
          hideLabel
          size="lg"
          icon="edit"
          placeholder="Nová cesta"
          testId="plan-name"
          disabled={readOnlyShared}
          value={plan.name}
          onChange={(event) =>
            applyCommand({ type: "update-plan", patch: { name: event.target.value } })
          }
        />

        <PlanOptions
          plan={plan}
          provider={provider}
          disabled={readOnlyShared}
          detourLimit={adventureDetourLimit}
          contextNotes={temporalContextNotes}
          onDetourLimit={(next) => {
            setAdventureDetourLimit(next);
            setAdventureRecommendation(null);
          }}
          onContextToggle={toggleRouteContext}
          onCommand={(command) => applyCommand(command)}
        />

        <StopList
          plan={plan}
          provider={provider}
          units={units}
          aiEnabled={aiEnabled}
          aiBusyStopId={aiStopBusyId}
          locatingStopId={locatingStopId}
          manual={manual}
          disabled={readOnlyShared}
          windowStart={stopWindowStart}
          onWindowStart={setStopWindowStart}
          selectedRouteSegmentId={selectedRouteSegmentId}
          temporalSegments={temporalSegments}
          stopPlaces={stopPlaces}
          aiStopAnswer={aiStopAnswer}
          onOpenAiCandidate={openAiStopCandidate}
          onDismissAiAnswer={() => setAiStopAnswer(null)}
          handlers={stopHandlers}
        />

        {plan.routePolicy.preference === "adventure" && (
          <PlanAdventure
            recommendation={adventureRecommendation}
            detourLimit={adventureDetourLimit}
            busy={adventureBusy}
            routed={totals.ready > 0}
            units={units}
            onApply={applyAdventureCandidates}
          />
        )}

        {totals.ready > 0 && (
          <p className="planner-hint">
            Trasa je složená ze skutečných úseků. Vyberte úsek tady nebo přímo v mapě; zvolená část
            se zvýrazní oranžově.
          </p>
        )}

        {error && (
          <InlineNotice tone="danger" testId="plan-error">
            {error}
          </InlineNotice>
        )}

        {aiEnabled && aiPlanOpen && !readOnlyShared && (
          <PlanAssistant
            prompt={aiPlanPrompt}
            busy={aiPlanBusy}
            threadLoading={aiThreadLoading}
            thread={aiThread}
            answer={aiPlanAnswer}
            persisted={savedRevision !== null}
            onPromptChange={setAiPlanPrompt}
            onSubmit={() => void discussPlan()}
            onNewThread={startNewAiThread}
          />
        )}

        <PlanShareDialog
          tab={shareTab}
          onTabChange={setShareTab}
          onClose={() => setShareTab(null)}
          exporting={exporting}
          onExport={(format) => void exportPlan(format)}
          shareTools={
            <PlanShareTools
              readOnlyShared={readOnlyShared}
              shareBusy={shareBusy}
              shareListLoading={shareListLoading}
              shareLinks={shareLinks}
              newShareUrl={newShareUrl}
              onShareSummary={() => void shareItinerary()}
              onCopyItinerary={() => void copyItinerary()}
              onCreateShare={() => void createShare()}
              onCopyShareUrl={() => void copyShareUrl()}
              onRevokeShare={(share) => void revokeShare(share)}
            />
          }
          handoffs={
            <div className="planner-handoffs">
              {externalHandoffs.map((handoff) => (
                <a
                  key={handoff.id}
                  className="planner-handoff"
                  data-testid={`handoff-${handoff.id}`}
                  href={handoff.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <strong>{handoff.label}</strong>
                  {handoff.limitation && <small>{handoff.limitation}</small>}
                </a>
              ))}
            </div>
          }
        />
      </div>
    </PanelShell>
  );
}
