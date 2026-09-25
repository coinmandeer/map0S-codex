import { isMapScenePatch, type MapScenePatch } from "@mapos/layer-sdk";
import { layerUnavailableReason } from "../../layers/registry";
import {
  statisticsSnapshot,
  activateStatistic,
  deactivateStatistic
} from "../../statistics/explorerStore";
import type { AreaSelection, TemporalState } from "@mapos/layer-sdk";
import { artifactSnapshot, setArtifacts } from "./artifactState";
import type { MapResultArtifact } from "@mapos/layer-sdk";
import { CATALOG_GROUPS, BASEMAPS } from "@mapos/layer-sdk";
import { applyCatalogItem } from "../layers/useCatalogActions";
import { planV1ToV2, type LayerManifestV2, type PlanDocumentV2 } from "@mapos/layer-sdk";
import { getMapStore, type RoutePreview } from "../../store/mapStore";
import type { MapAppearance } from "../../store/mapAppearance";
import { getLayerManifestV2 } from "../../layers";
import { answerBounds, answerResultManifest } from "../../layers/aiMapResults";
import { emit } from "../../lib/events";
import type { AiAnswer } from "./chatTypes";

export interface ConversationWorkspace {
  artifactIds?: string[];
  artifacts?: MapResultArtifact[];
  area?: AreaSelection | null;
  temporal?: Pick<TemporalState, "cursor" | "mode">;
  statistic?: { id: string; period: string; excluded: string[] } | null;
  appearance: MapAppearance;
  view: { lng: number; lat: number; zoom: number };
  plan: PlanDocumentV2 | null;
  route: RoutePreview | null;
  result: LayerManifestV2 | null;
}
export function captureWorkspace(): ConversationWorkspace {
  const store = getMapStore();
  const stats = statisticsSnapshot();
  return structuredClone({
    area: store.areaSelection,
    temporal: { cursor: store.temporal.cursor, mode: store.temporal.mode },
    statistic: stats.activeId
      ? {
          id: stats.activeId,
          period: stats.periods[stats.activeId] ?? "latest",
          excluded: stats.excluded[stats.activeId] ?? []
        }
      : null,
    artifacts: artifactSnapshot(),
    appearance: store.captureAppearance(),
    view: store.view,
    plan: store.activePlanDocument,
    route: store.routePreview,
    result: store.currentAnswerLayerId
      ? (getLayerManifestV2(store.currentAnswerLayerId) ?? null)
      : null
  });
}
/** A session with no saved scene must never inherit another session's results. */
export function clearConversationResults() {
  const store = getMapStore();
  store.hideAnswerResults();
  setArtifacts([]);
  store.setActivePlanDocument(null);
  store.setRoutePreview(null, false);
  store.setAreaSelection(null);
  deactivateStatistic();
  for (const [id, layer] of Object.entries(store.activeLayers))
    if (layer.visible) store.setLayerVisible(id, false);
  store.setTimeCursor(new Date(), "live");
}
export function restoreWorkspace(workspace: ConversationWorkspace) {
  const store = getMapStore();
  store.hideAnswerResults();
  setArtifacts(workspace.artifacts ?? []);
  if (workspace.area !== undefined) store.setAreaSelection(workspace.area);
  if (workspace.temporal)
    store.setTimeCursor(
      workspace.temporal.mode === "live" ? new Date() : workspace.temporal.cursor,
      workspace.temporal.mode
    );
  if (workspace.statistic !== undefined) {
    const stat = workspace.statistic;
    if (stat)
      void activateStatistic(stat.id, stat.period, stat.excluded, {
        reveal: false,
        fitCoverage: false
      });
    else deactivateStatistic();
  }
  store.restoreAppearance(workspace.appearance);
  store.setActivePlanDocument(workspace.plan);
  store.setRoutePreview(workspace.route, false);
  if (workspace.result) store.showAnswerResults(workspace.result);
  emit("fly-to", workspace.view);
}
/** Restore only fields still equal to this turn's changes; later manual edits win. */
export function undoWorkspace(before: ConversationWorkspace, applied: ConversationWorkspace) {
  const current = captureWorkspace();
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const appearance = structuredClone(current.appearance);
  for (const key of [
    "basemapId",
    "basemapLabels",
    "buildings3d",
    "terrain3d",
    "poiSources"
  ] as const) {
    if (equal(current.appearance[key], applied.appearance[key]))
      Object.assign(appearance, { [key]: before.appearance[key] });
  }
  for (const id of new Set([
    ...Object.keys(before.appearance.layers),
    ...Object.keys(applied.appearance.layers)
  ])) {
    const old = before.appearance.layers[id],
      next = applied.appearance.layers[id],
      now = current.appearance.layers[id];
    if (equal(now, next)) {
      if (old) appearance.layers[id] = old;
      else delete appearance.layers[id];
    } else if (old && next && now) {
      for (const key of ["visible", "selected", "opacity", "filters"] as const)
        if (equal(now[key], next[key])) Object.assign(appearance.layers[id]!, { [key]: old[key] });
    }
  }
  restoreWorkspace({
    ...current,
    area: equal(current.area, applied.area) ? before.area : current.area,
    temporal: equal(current.temporal, applied.temporal) ? before.temporal : current.temporal,
    statistic: equal(current.statistic, applied.statistic) ? before.statistic : current.statistic,
    appearance,
    plan: equal(current.plan, applied.plan) ? before.plan : current.plan,
    route: equal(current.route, applied.route) ? before.route : current.route,
    result: equal(current.result, applied.result) ? before.result : current.result,
    artifacts: equal(current.artifacts, applied.artifacts) ? before.artifacts : current.artifacts,
    view: equal(current.view, applied.view) ? before.view : current.view
  });
}
export function applyLayerSelectionCard(
  card: Extract<AiAnswer["cards"][number], { type: "layer" }>,
  question = ""
) {
  const store = getMapStore();
  const items = CATALOG_GROUPS.flatMap((g) => g.items);
  const selected = card.layerIds.map(
    (id) => items.find((i) => i.id === id) ?? { id, layer: id, cs: id, en: id }
  );
  const sourceIds = new Set(selected.map((i) => i.layer));
  for (const [id, state] of Object.entries(store.activeLayers))
    if (state.visible && !id.startsWith("ai-answer-") && !sourceIds.has(id))
      store.setLayerVisible(id, false);
  // Replace each selected facet once, then merge all requested categories for that source.
  const resetFacets = new Set<string>();
  for (const item of selected) {
    if (item.facet && !resetFacets.has(`${item.layer}:${item.facet}`)) {
      resetFacets.add(`${item.layer}:${item.facet}`);
      if (store.activeLayers[item.layer])
        store.setLayerFilters(item.layer, {
          ...store.activeLayers[item.layer]!.filters,
          [item.facet]: []
        });
    }
  }
  for (const item of selected) {
    const basemap = BASEMAPS.find((b) => b.id === item.id);
    if (basemap) {
      if (!basemap.requiresCapability || store.state.capabilities?.[basemap.requiresCapability])
        store.setBasemap(basemap.id);
      continue;
    }
    if (getLayerManifestV2(item.layer)) {
      applyCatalogItem(item, true);
      if (card.filters)
        store.setLayerFilters(item.layer, {
          ...store.activeLayers[item.layer]?.filters,
          ...card.filters
        });
      const opacity = card.opacityByLayer?.[item.id];
      if (typeof opacity === "number" && Number.isFinite(opacity) && opacity >= 0 && opacity <= 1)
        store.setLayerOpacity(item.layer, opacity);
    }
  }
  if (
    /obloh|hvezd|hvězd|stargaz|night sky/i.test(question) &&
    !selected.some((i) => BASEMAPS.some((b) => b.id === i.id))
  )
    store.setBasemap("carto-dark");
  if (
    card.time === null ||
    (typeof card.time === "string" && Number.isFinite(Date.parse(card.time)))
  )
    store.setTimeCursor(card.time ?? new Date(), card.time === null ? "live" : "preview");
}
export function applyMapAnswer(answer: AiAnswer, question: string, fitCamera = true) {
  const store = getMapStore();
  setArtifacts([]);
  const places = answer.cards.flatMap((card) => (card.type === "places" ? card.places : []));
  if (places.length)
    store.showAnswerResults(answerResultManifest("Výsledky konverzace", places, answer.sources));
  for (const card of answer.cards) {
    if (card.type === "layer-draft") {
      store.showAnswerResults(card.manifest);
      if (card.manifest.source.type === "inline" && card.manifest.source.inline && fitCamera) {
        const bbox = answerBounds(card.manifest.source.inline.features);
        if (bbox) emit("fit-bounds", { bbox });
      }
    }
    if (card.type === "layer") applyLayerSelectionCard(card, question);
    if (card.type === "plan" && card.stops.length >= 2) {
      const now = new Date().toISOString();
      const profile = card.profile ?? "foot";
      const plan = planV1ToV2(
        {
          id: `plan-ai-${crypto.randomUUID()}`,
          name: card.title,
          departureAt: now,
          variant: "fast",
          visibility: "private",
          vehicle: { profile },
          stops: card.stops.map((s, i) => ({
            id: `ai-stop-${i}`,
            name: s.title,
            lng: s.longitude,
            lat: s.latitude,
            dwellMinutes: 15
          }))
        },
        { now }
      );
      const draft = card.draft ? structuredClone(card.draft) : { ...plan, departureAt: null };
      const legs = card.route?.legs;
      if (legs?.length === draft.segments.length) {
        draft.segments = draft.segments.map((segment, index) => {
          const leg = legs[index]!;
          const alternativeId = `${segment.id}:computed`;
          return {
            ...segment,
            status: "ready",
            provider: leg.provider,
            profile: leg.profile,
            calculatedAt: now,
            selectedAlternativeId: alternativeId,
            warnings: [],
            alternatives: [
              {
                id: alternativeId,
                providerId: leg.provider,
                profile: leg.profile,
                preference: draft.routePolicy.preference,
                geometry: { type: "LineString", coordinates: leg.coordinates },
                distanceM: leg.distanceM,
                durationS: leg.durationS,
                computedAt: now,
                warnings: []
              }
            ]
          };
        });
      }
      store.setActivePlanDocument(draft);
      store.setRoutePreview(
        card.route
          ? {
              ...card.route,
              profile,
              stops: card.stops.map((s, i) => ({
                coordinates: [s.longitude, s.latitude],
                order: i,
                name: s.title
              }))
            }
          : null,
        false
      );
      const bbox = answerBounds(card.stops);
      if (bbox && fitCamera) emit("fit-bounds", { bbox });
    }
  }
  if (places.length && !answer.cards.some((c) => c.type === "plan")) {
    const bbox = answerBounds(places);
    if (bbox && fitCamera) emit("fit-bounds", { bbox });
  }
}

export function applyScenePatch(patch: MapScenePatch, fitCamera = true) {
  if (!isMapScenePatch(patch)) return false;
  const store = getMapStore();
  const basemap = BASEMAPS.find((b) => b.id === patch.basemapId);
  if (
    basemap &&
    (!basemap.requiresCapability || store.state.capabilities?.[basemap.requiresCapability])
  )
    store.setBasemap(basemap.id);
  for (const [id, layer] of Object.entries(patch.layers ?? {})) {
    if (
      !getLayerManifestV2(id) ||
      (layer.visible && layerUnavailableReason(id, store.state.capabilities, layer.filters))
    )
      continue;
    applyCatalogItem({ id, layer: id, cs: id, en: id }, layer.visible);
    store.setLayerFilters(id, layer.filters);
    store.setLayerOpacity(id, layer.opacity);
  }
  if (patch.bbox && fitCamera) emit("fit-bounds", { bbox: patch.bbox });
  if (patch.time !== undefined)
    store.setTimeCursor(patch.time ?? new Date(), patch.time === null ? "live" : "preview");
  return true;
}
