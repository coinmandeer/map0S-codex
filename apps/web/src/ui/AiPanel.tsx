import { useEffect, useRef, useState } from "react";
import {
  planV1ToV2,
  type LayerManifestV2,
  type PlanDocumentV2,
  type TripPlan
} from "@mapos/layer-sdk";
import { ApiError, apiPost, apiPostEventStream } from "../lib/api";
import { emit } from "../lib/events";
import { registerInlineLayer } from "../layers/inlineLayers";
import { saveInlineLayerAsUserLayer } from "../layers/saveInlineLayer";
import { formatDistance } from "../lib/units";
import { t } from "../i18n/cs";
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

interface AiPlanStop {
  title: string;
  longitude: number;
  latitude: number;
  day?: number;
  note?: string;
  sourceId: string;
}

interface AiPlanDiff {
  baseRevision: number;
  previewRevision: number;
  changedPlanFields: string[];
  addedStopIds: string[];
  removedStopIds: string[];
  movedStopIds: string[];
  updatedStopIds: string[];
  affectedSegmentIds: string[];
}

type AiCard =
  | { type: "places"; title: string; places: AiPlace[]; layerIds: string[] }
  | { type: "link"; title: string; url: string; excerpt?: string }
  | { type: "layer"; title: string; layerIds: string[] }
  | {
      type: "facts";
      title: string;
      items: { label: string; value: string; note?: string; sourceIds: string[] }[];
    }
  | {
      type: "layer-draft";
      title: string;
      layerId: string;
      manifest: LayerManifestV2;
      featureCount: number;
    }
  | { type: "plan"; title: string; summary: string; stops: AiPlanStop[] }
  | { type: "plan-edit"; title: string; proposalId: string; planId: string; diff: AiPlanDiff };

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

/** What the proposal would do, in the terms the user thinks in: stops, not revisions. */
function planDiffSummary(diff: AiPlanDiff): string {
  const parts: string[] = [];
  if (diff.addedStopIds.length) parts.push(`+${diff.addedStopIds.length} zastávka/y`);
  if (diff.removedStopIds.length) parts.push(`−${diff.removedStopIds.length} zastávka/y`);
  if (diff.movedStopIds.length) parts.push(`${diff.movedStopIds.length}× přesun`);
  if (diff.updatedStopIds.length) parts.push(`${diff.updatedStopIds.length}× úprava`);
  if (diff.changedPlanFields.length) parts.push(`změna: ${diff.changedPlanFields.join(", ")}`);
  return parts.length ? parts.join(" · ") : "Beze změny zastávek";
}

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
  const activePlanId = useMapStoreSnapshot((state) => state.activePlanDocument?.id ?? null);
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
  const [savingLayer, setSavingLayer] = useState<string | null>(null);
  const [savedLayers, setSavedLayers] = useState<Record<string, boolean>>({});
  const [proposals, setProposals] = useState<
    Record<string, "busy" | "confirmed" | "rejected" | "undone" | "failed">
  >({});
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
            mode,
            // The open plan is what "add a stop on day two" refers to; without it the assistant
            // is not offered the edit tool at all.
            ...(activePlanId ? { planId: activePlanId } : {})
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

  /** A drafted layer becomes a real one only here: the manifest is registered for this session
   *  and switched on, so it behaves like any other layer — including switching it back off. */
  const showLayerDraft = (card: Extract<AiCard, { type: "layer-draft" }>) => {
    const layerId = registerInlineLayer(card.manifest);
    if (!activeLayers[layerId]?.visible) store.toggleLayer(layerId);
    const first = card.manifest.source.inline?.features[0];
    if (first) {
      emit("fly-to", { lng: first.longitude, lat: first.latitude, zoom: Math.max(view.zoom, 11) });
    }
    store.showToast(`Vrstva ${card.manifest.name} je v mapě`, {
      action: { label: "Vrátit", onSelect: () => store.toggleLayer(layerId) }
    });
  };

  /** Saving turns the session layer into a personal one, provenance and all (§30.7). */
  const saveLayerDraft = async (card: Extract<AiCard, { type: "layer-draft" }>) => {
    setSavingLayer(card.layerId);
    try {
      const result = await saveInlineLayerAsUserLayer(card.manifest);
      setSavedLayers((current) => ({ ...current, [card.layerId]: true }));
      store.showToast(
        result.failed
          ? `Uloženo ${result.saved} míst, ${result.failed} se nepodařilo`
          : `Vrstva uložená v Moje vrstvy (${result.saved} míst)`
      );
    } catch (cause) {
      store.showToast(
        cause instanceof ApiError && cause.status === 401
          ? "Uložení vyžaduje přihlášení"
          : "Vrstvu se nepodařilo uložit"
      );
    } finally {
      setSavingLayer(null);
    }
  };

  /** The plan card opens a draft in Plánování; nothing is saved until the user saves it there. */
  const openPlanDraft = (card: Extract<AiCard, { type: "plan" }>) => {
    const now = new Date();
    const departure = new Date(now.getTime() + 15 * 60_000);
    departure.setSeconds(0, 0);
    const draft: TripPlan = {
      id: `plan-ai-${now.getTime()}`,
      name: card.title.slice(0, 120),
      departureAt: departure.toISOString(),
      variant: "fast",
      stops: card.stops.map((stop, index) => ({
        id: `ai-stop-${index + 1}`,
        name: stop.title,
        lng: stop.longitude,
        lat: stop.latitude,
        dwellMinutes: 45
      })),
      vehicle: { profile: "car" },
      visibility: "private"
    };
    const document: PlanDocumentV2 = planV1ToV2(draft, { now: now.toISOString() });
    store.setActivePlanDocument(document);
    shell.setMode("planning");
    store.showToast("Návrh plánu je otevřený v Plánování");
  };

  /** Confirming is the only thing that writes: the server re-reads the plan, applies the same
   *  command it showed in the diff, and hands back the plan — with one undo behind it (§30.8). */
  const decideProposal = async (
    card: Extract<AiCard, { type: "plan-edit" }>,
    action: "confirm" | "reject"
  ) => {
    setProposals((current) => ({ ...current, [card.proposalId]: "busy" }));
    try {
      const result = await apiPost<{ plan?: PlanDocumentV2 }>(
        `/v2/ai/plan-proposals/${card.proposalId}/${action}`,
        {},
        { auth: true }
      );
      setProposals((current) => ({
        ...current,
        [card.proposalId]: action === "confirm" ? "confirmed" : "rejected"
      }));
      if (action === "reject") return;
      if (result.plan) store.setActivePlanDocument(result.plan);
      store.showToast("Změna plánu potvrzena", {
        action: {
          label: "Vrátit",
          onSelect: () => {
            void apiPost<{ plan?: PlanDocumentV2 }>(
              `/v2/ai/plan-proposals/${card.proposalId}/undo`,
              {},
              { auth: true }
            )
              .then((undone) => {
                if (undone.plan) store.setActivePlanDocument(undone.plan);
                setProposals((current) => ({ ...current, [card.proposalId]: "undone" }));
              })
              .catch(() => store.showToast("Vrácení se nepodařilo"));
          }
        }
      });
    } catch {
      setProposals((current) => ({ ...current, [card.proposalId]: "failed" }));
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
                  ) : card.type === "facts" ? (
                    <section
                      key={`facts-${index}`}
                      className="ai-turn-card"
                      data-testid="ai-card-facts"
                    >
                      <p className="ai-turn-card-head">{card.title}</p>
                      <dl className="ai-turn-facts">
                        {card.items.map((item) => (
                          <div key={item.label}>
                            <dt>{item.label}</dt>
                            {/* The year and the caveat travel with the number, because a figure
                                without them is not checkable. */}
                            <dd>
                              {item.value}
                              {item.note ? <span>{item.note}</span> : null}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ) : card.type === "layer-draft" ? (
                    <section
                      key={`layer-draft-${index}`}
                      className="ai-turn-card"
                      data-testid="ai-card-layer-draft"
                    >
                      <p className="ai-turn-card-head">{card.title}</p>
                      <p className="ai-turn-card-note">
                        {card.featureCount} míst ze zdrojů, které odpověď cituje. Vrstva platí do
                        zavření aplikace.
                      </p>
                      <div className="ai-turn-card-actions">
                        <Button
                          variant="tonal"
                          size="sm"
                          icon="layers"
                          testId="ai-card-layer-draft-show"
                          onClick={() => showLayerDraft(card)}
                        >
                          Zobrazit v mapě
                        </Button>
                        <Button
                          variant="text"
                          size="sm"
                          icon="bookmark"
                          disabled={savingLayer === card.layerId || savedLayers[card.layerId]}
                          testId="ai-card-layer-draft-save"
                          onClick={() => void saveLayerDraft(card)}
                        >
                          {savedLayers[card.layerId]
                            ? "Uloženo v Moje vrstvy"
                            : "Uložit do Moje vrstvy"}
                        </Button>
                      </div>
                    </section>
                  ) : card.type === "plan" ? (
                    <section
                      key={`plan-${index}`}
                      className="ai-turn-card"
                      data-testid="ai-card-plan"
                    >
                      <p className="ai-turn-card-head">{card.title}</p>
                      <ol className="ai-turn-plan">
                        {card.stops.map((stop, position) => (
                          <li key={`${stop.title}-${position}`}>
                            <span>{stop.title}</span>
                            {stop.day ? <em>{stop.day}. den</em> : null}
                          </li>
                        ))}
                      </ol>
                      <Button
                        variant="tonal"
                        size="sm"
                        icon="route"
                        testId="ai-card-plan-open"
                        onClick={() => openPlanDraft(card)}
                      >
                        {t("ai.openInPlanning")}
                      </Button>
                    </section>
                  ) : card.type === "plan-edit" ? (
                    <section
                      key={`plan-edit-${index}`}
                      className="ai-turn-card"
                      data-testid="ai-card-plan-edit"
                    >
                      <p className="ai-turn-card-head">{card.title}</p>
                      <p className="ai-turn-card-note" data-testid="ai-card-plan-edit-diff">
                        {planDiffSummary(card.diff)}
                      </p>
                      {proposals[card.proposalId] === "confirmed" ? (
                        <InlineNotice tone="success">Změna je v plánu.</InlineNotice>
                      ) : proposals[card.proposalId] === "undone" ? (
                        <InlineNotice tone="info">Změna byla vrácena.</InlineNotice>
                      ) : proposals[card.proposalId] === "rejected" ? (
                        <InlineNotice tone="info">Návrh jsi zamítl.</InlineNotice>
                      ) : (
                        <div className="ai-turn-card-actions">
                          <Button
                            variant="filled"
                            size="sm"
                            icon="check"
                            disabled={proposals[card.proposalId] === "busy"}
                            testId="ai-card-plan-edit-confirm"
                            onClick={() => void decideProposal(card, "confirm")}
                          >
                            Potvrdit
                          </Button>
                          <Button
                            variant="text"
                            size="sm"
                            disabled={proposals[card.proposalId] === "busy"}
                            testId="ai-card-plan-edit-reject"
                            onClick={() => void decideProposal(card, "reject")}
                          >
                            Zamítnout
                          </Button>
                        </div>
                      )}
                      {proposals[card.proposalId] === "failed" && (
                        <InlineNotice tone="warning">
                          Plán se mezitím změnil, návrh už nesedí. Zeptej se znovu.
                        </InlineNotice>
                      )}
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
