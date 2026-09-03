import { useEffect, useRef, useState } from "react";
import { apiPostEventStream } from "../lib/api";
import { emit } from "../lib/events";
import { formatDistance } from "../lib/units";
import { getMapStore } from "../store/mapStore";
import { getShellStore } from "../store/shellStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { useShellStoreSnapshot } from "../store/useShellStoreSnapshot";
import { PanelShell } from "./PanelShell";
import {
  Button,
  Chip,
  EmptyState,
  IconButton,
  InlineNotice,
  ListItem,
  Popover,
  Skeleton,
  TextArea
} from "./kit";

interface AiPlace {
  id: string;
  layerId: string;
  title: string;
  category: string;
  longitude: number;
  latitude: number;
  distanceMeters?: number;
  sourceId: string;
}

interface AiCitation {
  sourceId: string;
  label: string;
  url?: string;
}

type AiCard =
  | { type: "places"; title: string; places: AiPlace[]; layerIds: string[] }
  | { type: "link"; title: string; url: string; excerpt?: string }
  | { type: "layer"; title: string; layerIds: string[] };

interface AiAnswer {
  execution: "model-tool-loop" | "deterministic";
  intent: string;
  text: string;
  cards: AiCard[];
  sources: AiCitation[];
  followUps: string[];
  model?: string;
}

type AiChatEvent =
  | { type: "intent"; intent: string; execution: AiAnswer["execution"] }
  | { type: "token"; text: string }
  | { type: "tool_start"; tool: string; title: string }
  | { type: "tool_result"; tool: string; status: string }
  | { type: "card"; card: AiCard }
  | { type: "done"; answer: AiAnswer; conversation: { id: string; revision: number } }
  | { type: "error"; code: string; message: string };

interface Turn {
  id: string;
  question: string;
  text: string;
  step: string | null;
  cards: AiCard[];
  sources: AiCitation[];
  followUps: string[];
  done: boolean;
  error: string | null;
}

const PRIVACY_DISMISSED_KEY = "mapos:ai-privacy-ack";

/** The map-wide assistant (§4.13, §30.6).
 *
 *  One thread over the map. A question is streamed to `/v2/ai/chat` together with a projection of
 *  the current view; what comes back is text plus cards, and a card is a proposal with one primary
 *  action — the assistant never changes the map by itself. While an answer is being prepared the
 *  tool the server is running is named, because "thinking…" tells nobody anything.
 */
export function AiPanel() {
  const store = getMapStore();
  const shell = getShellStore();
  const leftContext = useShellStoreSnapshot((state) => state.leftContext);
  const view = useMapStoreSnapshot((state) => state.view);
  const activeLayers = useMapStoreSnapshot((state) => state.activeLayers);
  const mode = useShellStoreSnapshot((state) => state.mode);
  const units = useMapStoreSnapshot((state) => state.preferences.units);
  const aiEnabled = useMapStoreSnapshot((state) => state.preferences.aiEnabled);
  const seeded = leftContext.type === "ai" ? leftContext.prompt : undefined;

  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [privacyAck, setPrivacyAck] = useState(
    () =>
      typeof window !== "undefined" && window.localStorage.getItem(PRIVACY_DISMISSED_KEY) === "1"
  );
  const askedSeed = useRef<string | null>(null);
  /** Only "Zastavit" aborts a turn. Aborting on unmount would also abort the seeded question,
   *  because a StrictMode mount runs the cleanup between the two effect passes. */
  const running = useRef<AbortController | null>(null);

  const visibleLayerIds = Object.entries(activeLayers)
    .filter(([, state]) => state.visible)
    .map(([layerId]) => layerId);

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    const id = `turn-${Date.now()}`;
    const patch = (change: (turn: Turn) => Turn) =>
      setTurns((current) => current.map((turn) => (turn.id === id ? change(turn) : turn)));

    setBusy(true);
    setTurns((current) => [
      ...current,
      {
        id,
        question: trimmed,
        text: "",
        step: null,
        cards: [],
        sources: [],
        followUps: [],
        done: false,
        error: null
      }
    ]);
    setPrompt("");

    const controller = new AbortController();
    running.current = controller;
    try {
      await apiPostEventStream<AiChatEvent>(
        "/v2/ai/chat",
        {
          message: trimmed,
          ...(conversationId ? { conversationId, baseRevision: revision } : {}),
          context: {
            mapCenter: { longitude: view.lng, latitude: view.lat },
            zoom: view.zoom,
            activeLayerIds: visibleLayerIds.slice(0, 20),
            mode
          },
          consent: { externalModel: aiEnabled, preciseLocation: false }
        },
        (event) => {
          if (event.type === "tool_start") patch((turn) => ({ ...turn, step: event.title }));
          if (event.type === "token") {
            patch((turn) => ({ ...turn, text: turn.text + event.text }));
          }
          if (event.type === "card") {
            patch((turn) => ({ ...turn, cards: [...turn.cards, event.card] }));
          }
          if (event.type === "done") {
            setConversationId(event.conversation.id);
            setRevision(event.conversation.revision);
            patch((turn) => ({
              ...turn,
              text: event.answer.text,
              step: null,
              cards: event.answer.cards,
              sources: event.answer.sources,
              followUps: event.answer.followUps,
              done: true
            }));
          }
          if (event.type === "error") {
            patch((turn) => ({ ...turn, step: null, error: event.message, done: true }));
          }
        },
        { signal: controller.signal, auth: true }
      );
    } catch (cause) {
      if (!controller.signal.aborted) {
        patch((turn) => ({
          ...turn,
          step: null,
          done: true,
          error:
            cause instanceof Error
              ? cause.message
              : "Odpověď se nepodařilo získat. Zkus dotaz zopakovat."
        }));
      }
    } finally {
      running.current = null;
      setBusy(false);
    }
  };

  // A question typed into search opens this panel already asked, so the user does not have to
  // retype it here.
  useEffect(() => {
    if (!seeded || askedSeed.current === seeded) return;
    askedSeed.current = seeded;
    void ask(seeded);
    // `ask` closes over state that changes with every turn; re-running on it would re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded]);

  const openPlace = (place: AiPlace) => {
    emit("fly-to", { lng: place.longitude, lat: place.latitude, zoom: Math.max(view.zoom, 15) });
    store.selectPin({
      feature: {
        type: "Feature",
        geometry: { type: "Point", coordinates: [place.longitude, place.latitude] },
        properties: { id: place.id, name: place.title, layerId: place.layerId }
      },
      layerId: place.layerId
    });
  };

  /** "Zobrazit v mapě": switch on whatever the answer needs and fly to the first result. No gate
   *  dialog before the answer, no layer switched on that the answer did not use (§30.4 point 3). */
  const showOnMap = (card: Extract<AiCard, { type: "places" }>) => {
    const missing = card.layerIds.filter((layerId) => !activeLayers[layerId]?.visible);
    for (const layerId of missing) store.toggleLayer(layerId);
    const first = card.places[0];
    if (first) {
      emit("fly-to", { lng: first.longitude, lat: first.latitude, zoom: Math.max(view.zoom, 13) });
    }
    if (missing.length) {
      store.showToast(`Zapnuto: ${missing.join(", ")}`, {
        action: {
          label: "Vrátit",
          onSelect: () => missing.forEach((layerId) => store.toggleLayer(layerId))
        }
      });
    }
  };

  return (
    <PanelShell
      title="Asistent"
      testId="ai-panel"
      dismissible
      busy={busy}
      busyLabel="Ptám se AI"
      hasContent={turns.length > 0}
      onBack={
        leftContext.type === "ai" && leftContext.prompt ? () => shell.closeLeftContext() : undefined
      }
      headerExtra={
        turns.length > 0 ? (
          <IconButton
            icon="forum"
            label="Nové vlákno"
            size="sm"
            testId="ai-panel-clear"
            onClick={() => {
              setTurns([]);
              setConversationId(null);
              setRevision(0);
            }}
          />
        ) : undefined
      }
      footer={
        <form
          className="ai-panel-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(prompt);
          }}
        >
          {turns.at(-1)?.followUps.length && !busy ? (
            <div className="ai-panel-followups">
              {turns.at(-1)!.followUps.map((suggestion) => (
                <Chip
                  key={suggestion}
                  label={suggestion}
                  testId="ai-panel-followup"
                  onClick={() => void ask(suggestion)}
                />
              ))}
            </div>
          ) : null}
          <TextArea
            label="Na co se chceš zeptat?"
            rows={2}
            maxLength={2_000}
            value={prompt}
            placeholder="Např. kde je poblíž klidný kemp u vody?"
            onChange={(event) => setPrompt(event.target.value)}
          />
          {busy ? (
            <Button
              variant="tonal"
              icon="close"
              block
              testId="ai-panel-stop"
              onClick={() => running.current?.abort()}
            >
              Zastavit
            </Button>
          ) : (
            <Button
              type="submit"
              variant="filled"
              icon="send"
              block
              disabled={!prompt.trim()}
              testId="ai-panel-send"
            >
              Odeslat
            </Button>
          )}
        </form>
      }
    >
      {/* What the assistant can see, in one line and one click — this replaces the disclosure
          paragraphs that used to repeat under every answer (§30.6). */}
      <Popover
        trigger={
          <Chip
            label={`Kontext: ${visibleLayerIds.length} ${visibleLayerIds.length === 1 ? "vrstva" : "vrstev"}`}
            icon="layers"
            testId="ai-panel-context"
          />
        }
        title="Co AI vidí"
      >
        <ul className="ai-panel-context-list">
          <li>
            Střed mapy zaokrouhlený na ~1 km ({view.lat.toFixed(2)}, {view.lng.toFixed(2)})
          </li>
          <li>Aktivní vrstvy: {visibleLayerIds.length ? visibleLayerIds.join(", ") : "žádné"}</li>
          <li>Text dotazu a předchozí zprávy v tomto vláknu</li>
          <li>Ne: přesná poloha, tvoje uložená místa ani poznámky v plánech</li>
        </ul>
      </Popover>

      {!privacyAck && (
        <InlineNotice
          tone="info"
          testId="ai-panel-privacy"
          action={
            <Button
              variant="text"
              size="sm"
              onClick={() => {
                window.localStorage.setItem(PRIVACY_DISMISSED_KEY, "1");
                setPrivacyAck(true);
              }}
            >
              Rozumím
            </Button>
          }
        >
          Odesílá se dotaz, střed mapy a názvy aktivních vrstev — ne přesná poloha.
        </InlineNotice>
      )}

      {turns.length === 0 && !busy && (
        <EmptyState
          icon="auto_awesome"
          title="Zeptej se na okolí, trasu nebo vrstvu. Odpověď doplním místy z mapy."
          testId="ai-panel-empty"
        />
      )}

      <div className="ai-panel-thread" data-testid="ai-panel-thread" aria-live="polite">
        {turns.map((turn) => (
          <article key={turn.id} className="ai-turn">
            <p className="ai-turn-question">{turn.question}</p>
            {turn.error ? (
              <InlineNotice tone="warning" testId="ai-panel-error">
                {turn.error}
              </InlineNotice>
            ) : !turn.text ? (
              <>
                {turn.step && (
                  <p className="ai-turn-step" data-testid="ai-panel-step">
                    {turn.step}…
                  </p>
                )}
                <Skeleton height={12} count={3} />
              </>
            ) : (
              <>
                <p className="ai-turn-answer">{turn.text}</p>

                {turn.cards.map((card, index) =>
                  card.type === "places" ? (
                    <section
                      key={`places-${index}`}
                      className="ai-turn-card"
                      data-testid="ai-card-places"
                    >
                      <p className="ai-turn-card-head">{card.title}</p>
                      <div className="ai-turn-places">
                        {card.places.map((place, position) => (
                          <ListItem
                            key={place.id}
                            title={`${position + 1}. ${place.title}`}
                            subtitle={
                              place.distanceMeters === undefined
                                ? undefined
                                : formatDistance(place.distanceMeters, units)
                            }
                            icon="place"
                            ariaLabel={`Otevřít detail místa ${place.title}`}
                            onClick={() => openPlace(place)}
                          />
                        ))}
                      </div>
                      <Button
                        variant="tonal"
                        size="sm"
                        icon="map"
                        testId="ai-card-places-show"
                        onClick={() => showOnMap(card)}
                      >
                        Zobrazit v mapě
                      </Button>
                    </section>
                  ) : card.type === "link" ? (
                    <a
                      key={`link-${index}`}
                      className="ai-turn-link"
                      href={card.url}
                      target="_blank"
                      rel="noreferrer"
                      data-testid="ai-card-link"
                    >
                      {card.title}
                    </a>
                  ) : null
                )}

                {turn.sources.length > 0 && (
                  <div className="ai-turn-sources">
                    {[
                      ...new Map(turn.sources.map((source) => [source.label, source])).values()
                    ].map((source) => (
                      <Chip key={source.label} label={source.label} />
                    ))}
                  </div>
                )}
              </>
            )}
          </article>
        ))}
      </div>
    </PanelShell>
  );
}
