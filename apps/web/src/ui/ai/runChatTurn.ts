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
    await apiPostEventStream<AiChatEvent>(
      "/v2/ai/chat",
      {
        message: trimmed,
        ...(conversationId ? { conversationId, baseRevision: revision } : {}),
        context: {
          mapCenter: { longitude: view.lng, latitude: view.lat },
          zoom: view.zoom,
          activeLayerIds,
          mode: store.mode,
          worldId: store.experienceId,
          ...(bbox && bbox[0] >= -180 && bbox[2] <= 180 ? { bbox } : {}),
          ...(featureRef ? { featureRef } : {}),
          ...(area ? { areaId: area.id, boundaryRevision: area.revision } : {}),
          ...(store.activePlanDocument ? { planId: store.activePlanDocument.id } : {})
        },
        consent: { externalModel: store.preferences.aiEnabled, preciseLocation: false }
      },
      (event) => {
        if (!current()) return;
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
          const statistic = event.answer.cards.find((card) => card.type === "statistic");
          if (statistic?.type === "statistic") showStatisticAnswer(statistic);
        }
        if (event.type === "error")
          patch((turn) => ({ ...turn, step: null, error: event.message, done: true }));
      },
      { auth: true, signal: controller.signal }
    );
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
