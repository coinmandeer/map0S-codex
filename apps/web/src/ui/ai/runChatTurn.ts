import { emit } from "../../lib/events";
import {
  isMapResultArtifact,
  isMapContextSnapshot,
  mapArtifactBounds,
  type MapContextSnapshot,
  type MapResultArtifact
} from "@mapos/layer-sdk";
import { setArtifacts } from "./artifactState";
import { apiGet } from "../../lib/api";
import { applyMapAnswer, applyScenePatch, captureWorkspace, undoWorkspace } from "./mapScene";
import { apiPostEventStream } from "../../lib/api";
import { bootstrapGuestSession } from "../../lib/sessionBootstrap";
import { getMapStore } from "../../store/mapStore";
import { chatSession } from "./chatSession";
import { showStatisticAnswer } from "./statisticAnswer";
import type { AiChatEvent, Turn } from "./chatTypes";

/** One owner for panel and search: navigation changes subscribers, not conversation or request. */
export async function runChatTurn(
  question: string,
  featureRef?: { layerId: string; featureId: string }
) {
  const trimmed = question.trim(),
    store = getMapStore();
  if (!trimmed || chatSession.state.busy || !store.preferences.aiEnabled) return;
  if (chatSession.state.archived) {
    chatSession.set("historyError", "Nejprve obnov konverzaci z archivu.");
    return;
  }
  const before = captureWorkspace();
  let completed = false;
  let sceneApplied = false;
  let cameraFitRequested = false;
  let streamRunId: string | null = null;
  let lastSequence = 0;
  const transaction: { applied: ReturnType<typeof captureWorkspace> | null } = { applied: null };
  let statisticApplied: Promise<void> | undefined;
  const artifacts: Promise<MapResultArtifact | null>[] = [];
  const progressive = new Map<string, MapResultArtifact>();
  const { conversationId, revision } = chatSession.state;
  const generation = chatSession.generation,
    id = crypto.randomUUID();
  const controller = new AbortController();
  const current = () => generation === chatSession.generation && !controller.signal.aborted;
  const patch = (change: (turn: Turn) => Turn) => {
    if (generation === chatSession.generation)
      chatSession.set("turns", (turns) =>
        turns.map((turn) => (turn.id === id ? change(turn) : turn))
      );
  };
  const area = store.areaSelection,
    view = store.view,
    bbox = store.viewportBbox;
  const activeLayerIds = Object.entries(store.activeLayers)
    .filter(([id, state]) => state.visible && !id.startsWith("ai-answer-"))
    .map(([id]) => id)
    .slice(0, 20);
  const snapshot: MapContextSnapshot = {
    schema: "mapos.map-context",
    schemaVersion: "1.0.0",
    revision,
    basemapId: store.captureAppearance().basemapId,
    view: { longitude: view.lng, latitude: view.lat, zoom: view.zoom },
    ...(bbox && bbox[0] >= -180 && bbox[2] <= 180 ? { bbox } : {}),
    layers: Object.fromEntries(
      Object.entries(store.activeLayers)
        .filter(([id]) => !id.startsWith("ai-answer-"))
        .slice(0, 100)
        .map(([id, layer]) => [
          id,
          { visible: layer.visible, opacity: layer.opacity, filters: layer.filters }
        ])
    ),
    time: store.temporal.mode === "preview" ? store.temporal.cursor : null,
    areaId: area?.id ?? null,
    selectedFeatureIds: featureRef ? [`${featureRef.layerId}:${featureRef.featureId}`] : [],
    planRevision: store.activePlanDocument?.revision ?? null
  };
  chatSession.set("busy", true);
  chatSession.set("turns", (turns) => [
    ...turns,
    {
      id,
      question: trimmed,
      scopeKey: JSON.stringify([
        bbox,
        area?.id,
        area?.revision,
        store.experienceId,
        featureRef,
        activeLayerIds.map((id) => [id, store.activeLayers[id]?.filters]),
        store.temporal,
        store.activePlanDocument?.revision
      ]),
      scopeLabel: "Oblast podle otázky; výřez pouze jako kontext",
      requestedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      text: "",
      step: "Připravuji odpověď",
      cards: [],
      sources: [],
      followUps: [],
      done: false,
      error: null
    }
  ]);
  chatSession.set("prompt", "");
  chatSession.running.current = controller;
  try {
    // A first-time visitor has no cookie until the shared guest bootstrap completes.
    if (!store.session) await bootstrapGuestSession(controller.signal);
    if (!current()) return;
    await apiPostEventStream<
      AiChatEvent & { runId?: string; sequence?: number; revision?: number }
    >(
      "/v2/ai/chat",
      {
        message: trimmed,
        clientRequestId: id,
        ...(conversationId ? { conversationId, baseRevision: revision } : {}),
        context: {
          ...(isMapContextSnapshot(snapshot) ? { mapSnapshot: snapshot } : {}),
          mapCenter: { longitude: view.lng, latitude: view.lat },
          zoom: view.zoom,
          activeLayerIds,
          mode: store.mode,
          ...(store.temporal.mode === "preview" ? { selectedTime: store.temporal.cursor } : {}),
          worldId: store.experienceId,
          ...(bbox && bbox[0] >= -180 && bbox[2] <= 180 ? { bbox } : {}),
          ...(featureRef ? { featureRef } : {}),
          ...(area ? { areaId: area.id, boundaryRevision: area.revision } : {}),
          ...(store.activePlanDocument
            ? {
                planId: store.activePlanDocument.id,
                tripDraft: { ...store.activePlanDocument, segments: [], annotations: [] }
              }
            : {})
        },
        consent: { externalModel: store.preferences.aiEnabled, preciseLocation: false }
      },
      (event) => {
        if (!current()) return;
        if (event.runId && event.sequence !== undefined) {
          if (streamRunId !== null && streamRunId !== event.runId) return;
          if (!Number.isSafeInteger(event.sequence) || event.sequence <= lastSequence) return;
          if (event.revision !== undefined && event.revision < revision) return;
          streamRunId = event.runId;
          lastSequence = event.sequence;
        }
        if (
          event.type === "scene_patch" &&
          event.patch.runId === event.runId &&
          event.patch.conversationId === event.conversationId &&
          event.patch.revision === event.revision
        ) {
          const fitScene =
            !cameraFitRequested && JSON.stringify(store.view) === JSON.stringify(before.view);
          sceneApplied = applyScenePatch(event.patch, fitScene);
          if (sceneApplied && event.patch.bbox && fitScene) cameraFitRequested = true;
          if (sceneApplied) patch((turn) => ({ ...turn, step: event.patch.explanation }));
        }
        if (event.type === "map_artifact")
          artifacts.push(
            apiGet<unknown>(`/v2/ai/artifacts/${encodeURIComponent(event.artifactId)}`, {
              auth: true,
              signal: controller.signal
            })
              .then((value) =>
                isMapResultArtifact(value) &&
                value.conversationId === event.conversationId &&
                value.runId === event.runId &&
                value.revision === event.revision
                  ? value
                  : null
              )
              .then((value) => {
                if (!value || !current() || completed || event.phase !== "preview") return value;
                const previous = progressive.get(value.id);
                if (previous && previous.revision > value.revision) return value;
                progressive.set(value.id, value);
                store.hideAnswerResults();
                setArtifacts([...progressive.values()]);
                if (
                  !cameraFitRequested &&
                  JSON.stringify(store.view) === JSON.stringify(before.view)
                ) {
                  const bounds = mapArtifactBounds([...progressive.values()]);
                  if (bounds) emit("fit-bounds", { bbox: bounds });
                  cameraFitRequested = true;
                }
                transaction.applied = captureWorkspace();
                chatSession.undoMap = () => {
                  if (transaction.applied) undoWorkspace(before, transaction.applied);
                };
                return value;
              })
              .catch(() => null)
          );
        if (event.type === "conversation" || event.type === "done") {
          chatSession.set("conversationId", event.conversation.id);
          chatSession.set("revision", event.conversation.revision);
        }
        if (event.type === "tool_start") patch((turn) => ({ ...turn, step: event.title }));
        if (event.type === "token") patch((turn) => ({ ...turn, text: turn.text + event.text }));
        if (event.type === "sources") patch((turn) => ({ ...turn, sources: event.sources }));
        if (event.type === "card")
          patch((turn) => ({ ...turn, cards: [...turn.cards, event.card] }));
        if (event.type === "done") {
          patch((turn) => ({
            ...turn,
            text: event.answer.text,
            cards: event.answer.cards,
            sources: event.answer.sources,
            followUps: event.answer.followUps,
            step: null,
            done: true
          }));
          const cameraAlreadyFit = cameraFitRequested;
          cameraFitRequested ||= event.answer.cards.some(
            (card) => card.type === "plan" || card.type === "places"
          );
          applyMapAnswer(
            sceneApplied
              ? { ...event.answer, cards: event.answer.cards.filter((c) => c.type !== "layer") }
              : event.answer,
            trimmed,
            !cameraAlreadyFit && JSON.stringify(store.view) === JSON.stringify(before.view)
          );
          completed = true;
          const statistic = event.answer.cards.find((card) => card.type === "statistic");
          if (statistic?.type === "statistic")
            statisticApplied = showStatisticAnswer(
              statistic,
              JSON.stringify(store.view) === JSON.stringify(before.view),
              controller.signal,
              () => {
                if (!current() || !transaction.applied) return;
                const delivered = captureWorkspace();
                transaction.applied.statistic = delivered.statistic;
                const layerId = `theme-${statistic.themeId}`;
                const layer = delivered.appearance.layers[layerId];
                if (layer) transaction.applied.appearance.layers[layerId] = layer;
              }
            );
          transaction.applied = captureWorkspace();
          chatSession.undoMap = () => {
            if (transaction.applied) undoWorkspace(before, transaction.applied);
          };
        }
        if (event.type === "error")
          patch((turn) => ({ ...turn, step: null, error: event.message, done: true }));
      },
      { auth: true, signal: controller.signal }
    );
    if (statisticApplied) await statisticApplied;
    if (completed && current() && artifacts.length) {
      const results = (await Promise.all(artifacts)).filter(
        (a): a is MapResultArtifact => a !== null
      );
      if (current() && results.length) {
        store.hideAnswerResults();
        setArtifacts(results);
        if (!cameraFitRequested && JSON.stringify(store.view) === JSON.stringify(before.view)) {
          const bbox = mapArtifactBounds(results);
          if (bbox) emit("fit-bounds", { bbox });
          cameraFitRequested = true;
        }
        const applied = transaction.applied;
        if (applied) {
          // Only record fields changed by artifact delivery. Manual changes made during the
          // fetch must not become part of the AI transaction's undo baseline.
          const delivered = captureWorkspace();
          applied.artifacts = delivered.artifacts;
          applied.result = delivered.result;
          for (const [id, layer] of Object.entries(delivered.appearance.layers))
            if (id.startsWith("ai-answer-")) applied.appearance.layers[id] = layer;
        }
      }
    }
    if (completed && current())
      await chatSession
        .saveWorkspace()
        .catch(() => store.showToast("Odpověď je dostupná; mapový pohled se nepodařilo uložit."));
  } catch (cause) {
    if (!controller.signal.aborted)
      patch((turn) => ({
        ...turn,
        done: true,
        step: null,
        error: cause instanceof Error ? cause.message : "Odpověď se nepodařilo načíst."
      }));
  } finally {
    patch((turn) =>
      turn.done
        ? turn
        : {
            ...turn,
            done: true,
            step: null,
            error: controller.signal.aborted
              ? "Zastaveno. Získané údaje zůstávají dostupné."
              : "Přenos se přerušil. Zobrazuji získanou část odpovědi."
          }
    );
    if (generation === chatSession.generation) {
      chatSession.running.current = null;
      chatSession.set("busy", false);
    }
  }
}
