import { useEffect, useState } from "react";
import { planV1ToV2, type PlanDocumentV2, type TripPlan } from "@mapos/layer-sdk";
import { ApiError, apiPost } from "../lib/api";
import { emit, on } from "../lib/events";
import { getLayerManifestV2 } from "../layers";
import { answerResultManifest, answerBounds, AI_RESULT_PREFIX } from "../layers/aiMapResults";
import { saveInlineLayerAsUserLayer } from "../layers/saveInlineLayer";
import { formatDistance } from "../lib/units";
import { t } from "../i18n";
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

import type { AiPlace, AiCitation, AiCard, AiPlanDiff } from "./ai/chatTypes";
import { runChatTurn } from "./ai/runChatTurn";
import { showStatisticAnswer } from "./ai/statisticAnswer";
import { chatSession, useChatField } from "./ai/chatSession";

const PRIVACY_DISMISSED_KEY = "mapos:ai-privacy-ack";

/** Layer ids are the model's vocabulary, not the user's — show the catalogue name where there
 *  is one, and fall back to the id so an unknown layer is still named rather than hidden. */
function layerSelectionName(layerId: string): string {
  return getLayerManifestV2(layerId)?.name ?? layerId;
}

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
  const viewportBbox = useMapStoreSnapshot((state) => state.viewportBbox);
  const area = useMapStoreSnapshot((state) => state.areaSelection);
  const world = useMapStoreSnapshot((state) => state.experienceId);

  const view = useMapStoreSnapshot((state) => state.view);
  const activeLayers = useMapStoreSnapshot((state) => state.activeLayers);
  const units = useMapStoreSnapshot((state) => state.preferences.units);
  const seeded = leftContext.type === "ai" ? leftContext.prompt : undefined;
  const seedKey =
    leftContext.type === "ai" ? JSON.stringify([leftContext.prompt, leftContext.requestKey]) : null;

  const [hoveredPlace, setHoveredPlace] = useState<string | null>(null);
  useEffect(
    () =>
      on("ai-pin-hover", (ref) =>
        setHoveredPlace(ref ? JSON.stringify([ref.layerId, ref.featureId]) : null)
      ),
    []
  );
  useEffect(() => () => emit("ai-result-hover", null), []);
  const [prompt, setPrompt] = useChatField("prompt");
  const [turns] = useChatField("turns");
  const [busy] = useChatField("busy");
  const [privacyAck, setPrivacyAck] = useState(
    () =>
      typeof window !== "undefined" && window.localStorage.getItem(PRIVACY_DISMISSED_KEY) === "1"
  );
  const [savingLayer, setSavingLayer] = useState<string | null>(null);
  const [savedLayers, setSavedLayers] = useState<Record<string, boolean>>({});
  const [proposals, setProposals] = useState<
    Record<string, "busy" | "confirmed" | "rejected" | "undone" | "failed">
  >({});

  /** Only "Zastavit" aborts a turn. Aborting on unmount would also abort the seeded question,
   *  because a StrictMode mount runs the cleanup between the two effect passes. */
  const running = chatSession.running;

  const visibleLayerIds = Object.entries(activeLayers)
    .filter(([id, state]) => state.visible && !id.startsWith(AI_RESULT_PREFIX))
    .map(([layerId]) => layerId);

  const featureRef = leftContext.type === "ai" ? leftContext.featureRef : undefined;
  const scopeKey = JSON.stringify([
    viewportBbox,
    area?.id,
    area?.revision,
    world,
    featureRef,
    visibleLayerIds.map((id) => [id, activeLayers[id]?.filters]),
    store.temporal,
    store.activePlanDocument?.revision
  ]);

  const ask = (question: string) => runChatTurn(question, featureRef);

  // A question typed into search opens this panel already asked, so the user does not have to
  // retype it here.
  useEffect(() => {
    if (!seeded || chatSession.askedSeed === seedKey) return;
    chatSession.askedSeed = seedKey;
    void ask(seeded);
    // `ask` closes over state that changes with every turn; re-running on it would re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded, seedKey]);

  const openPlace = (place: AiPlace) => {
    emit("fly-to", { lng: place.longitude, lat: place.latitude, zoom: Math.max(view.zoom, 15) });
    store.selectPin({
      feature: {
        type: "Feature",
        geometry: { type: "Point", coordinates: [place.longitude, place.latitude] },
        properties: {
          id: place.sourceFeatureId ?? place.id,
          name: place.title,
          layerId: place.layerId
        }
      },
      layerId: place.layerId
    });
  };

  const fitResults = (points: readonly { longitude: number; latitude: number }[]) => {
    const bbox = answerBounds(points);
    if (bbox) emit("fit-bounds", { bbox });
  };
  const showOnMap = (card: Extract<AiCard, { type: "places" }>, sources: AiCitation[]) => {
    store.showAnswerResults(answerResultManifest(card.title, card.places, sources));
  };

  /** "Zapni mi vrstvy pro…" (§4.13). `set_layer_selection_draft` is a draft on purpose: the
   *  model names the layers, the user is the one who switches them on. */
  const applyLayerSelection = (card: Extract<AiCard, { type: "layer" }>) => {
    const missing = card.layerIds.filter((layerId) => !activeLayers[layerId]?.visible);
    for (const layerId of missing) store.toggleLayer(layerId);
    for (const layerId of card.layerIds) {
      const manifest = getLayerManifestV2(layerId);
      const allowed = Object.fromEntries(
        Object.entries(card.filters ?? {}).filter(([key, value]) => {
          const facet = manifest?.filters?.find((f) => f.id === key);
          if (!facet) return false;
          if (facet.kind === "toggle") return typeof value === "boolean";
          if (facet.kind === "range" || facet.kind === "distance")
            return (
              typeof value === "number" &&
              Number.isFinite(value) &&
              value >= (facet.min ?? -Infinity) &&
              value <= (facet.max ?? Infinity)
            );
          if (facet.kind === "multi-select")
            return (
              Array.isArray(value) &&
              value.every((v) => facet.options?.some((option) => option.id === v))
            );
          return false;
        })
      );
      if (Object.keys(allowed).length)
        store.setLayerFilters(layerId, { ...store.activeLayers[layerId]?.filters, ...allowed });
    }
    store.showToast(`Zapnuto: ${missing.map(layerSelectionName).join(", ")}`, {
      action: {
        label: "Vrátit",
        onSelect: () => missing.forEach((layerId) => store.toggleLayer(layerId))
      }
    });
  };

  const showLayerDraft = (card: Extract<AiCard, { type: "layer-draft" }>) => {
    store.showAnswerResults(card.manifest);
  };

  /** Saving turns the session layer into a personal one, provenance and all (§30.7). */
  const saveLayerDraft = async (card: Extract<AiCard, { type: "layer-draft" }>) => {
    setSavingLayer(card.layerId);
    try {
      const result = await saveInlineLayerAsUserLayer(card.manifest);
      setSavedLayers((current) => ({ ...current, [card.layerId]: true }));
      store.showToast(
        result.failed
          ? t("ai.layerDraft.toastPartial", { saved: result.saved, failed: result.failed })
          : t("ai.layerDraft.toastSaved", { count: result.saved })
      );
    } catch (cause) {
      store.showToast(
        cause instanceof ApiError && cause.status === 401
          ? t("ai.layerDraft.toastAuth")
          : t("ai.layerDraft.toastFailed")
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
              chatSession.clear();
              chatSession.askedSeed = seedKey;
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
      {Object.keys(activeLayers).some(
        (id) => id.startsWith(AI_RESULT_PREFIX) && activeLayers[id]?.visible
      ) && (
        <Button
          variant="text"
          size="sm"
          icon="close"
          testId="ai-results-hide"
          onClick={() => store.hideAnswerResults()}
        >
          Skrýt výsledky AI
        </Button>
      )}
      {/* What the assistant can see, in one line and one click — this replaces the disclosure
          paragraphs that used to repeat under every answer (§30.6). */}
      <Popover
        trigger={
          <Chip
            label={t("ai.context.chip", { count: visibleLayerIds.length })}
            icon="layers"
            testId="ai-panel-context"
          />
        }
        title={t("ai.context.title")}
      >
        <ul className="ai-panel-context-list">
          <li>
            {t("ai.context.centre", {
              lat: view.lat.toFixed(2),
              lng: view.lng.toFixed(2)
            })}
          </li>
          <li>
            {t("ai.context.layers", {
              layers: visibleLayerIds.length ? visibleLayerIds.join(", ") : t("ai.context.none")
            })}
          </li>
          <li>{t("ai.context.thread")}</li>
          <li>{t("ai.context.never")}</li>
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
              {t("ai.consent.accept")}
            </Button>
          }
        >
          {t("ai.privacy.notice")}
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
            <p className="ai-turn-step">
              {turn.scopeLabel} · dotaz {turn.requestedAt}
            </p>
            {turn.scopeKey !== scopeKey &&
              !turn.cards.some((card) => card.type === "statistic") && (
                <Button
                  variant="text"
                  size="sm"
                  disabled={busy}
                  onClick={() => void ask(turn.question)}
                >
                  Obnovit pro tento výřez
                </Button>
              )}
            {turn.error && (
              <InlineNotice tone="warning" testId="ai-panel-error">
                {turn.error}
              </InlineNotice>
            )}
            {!turn.done && turn.step && (
              <p className="ai-turn-step" data-testid="ai-panel-progress">
                {turn.step}…
              </p>
            )}
            {!turn.text && !turn.cards.length && !turn.done ? (
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
                          <div
                            key={`${place.layerId}:${place.id}`}
                            onPointerEnter={() =>
                              emit("ai-result-hover", {
                                layerId: place.layerId,
                                featureId: place.sourceFeatureId ?? place.id
                              })
                            }
                            onPointerLeave={() => emit("ai-result-hover", null)}
                            onFocus={() =>
                              emit("ai-result-hover", {
                                layerId: place.layerId,
                                featureId: place.sourceFeatureId ?? place.id
                              })
                            }
                            onBlur={() => emit("ai-result-hover", null)}
                          >
                            <ListItem
                              active={
                                hoveredPlace ===
                                JSON.stringify([place.layerId, place.sourceFeatureId ?? place.id])
                              }
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
                          </div>
                        ))}
                      </div>
                      <Button
                        variant="tonal"
                        size="sm"
                        icon="map"
                        testId="ai-card-places-show"
                        disabled={!turn.sources.length}
                        onClick={() => showOnMap(card, turn.sources)}
                      >
                        Zobrazit v mapě
                      </Button>
                      <Button
                        variant="text"
                        size="sm"
                        onClick={() => fitResults(card.places.slice(0, 100))}
                      >
                        Přiblížit výsledky
                      </Button>
                    </section>
                  ) : card.type === "statistic" ? (
                    <section key={`statistic-${index}`} className="ai-turn-card">
                      <p>
                        {card.title} · {card.period} · {card.geoLevel.toUpperCase()}
                      </p>
                      <Button onClick={() => showStatisticAnswer(card)}>
                        {card.available
                          ? "Zobrazit statistiku v mapě"
                          : "Přiblížit požadovanou zemi"}
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
                              {item.sourceIds.map((id) => {
                                const source = turn.sources.find((s) => s.sourceId === id);
                                return source?.url ? (
                                  <a key={id} href={source.url} target="_blank" rel="noreferrer">
                                    [{source.label}]
                                  </a>
                                ) : source ? (
                                  <small key={id}>[{source.label}]</small>
                                ) : null;
                              })}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ) : card.type === "layer" ? (
                    <section
                      key={`layer-${index}`}
                      className="ai-turn-card"
                      data-testid="ai-card-layer"
                    >
                      <p className="ai-turn-card-head">{card.title}</p>
                      <div className="ai-turn-card-chips">
                        {card.layerIds.map((layerId) => (
                          <Chip
                            key={layerId}
                            icon="layers"
                            label={layerSelectionName(layerId)}
                            active={activeLayers[layerId]?.visible}
                          />
                        ))}
                        {card.filters?.openNow && <Chip icon="schedule" label="Otevřeno teď" />}
                        {card.filters?.minRating != null && (
                          <Chip icon="star" label={`Od ${card.filters.minRating} ★`} />
                        )}
                        {card.filters?.tags?.map((tag) => (
                          <Chip key={tag} icon="label" label={tag} />
                        ))}
                      </div>
                      <div className="ai-turn-card-actions">
                        <Button
                          variant="tonal"
                          size="sm"
                          icon="layers"
                          testId="ai-card-layer-apply"
                          onClick={() => applyLayerSelection(card)}
                        >
                          Zapnout v mapě
                        </Button>
                      </div>
                    </section>
                  ) : card.type === "layer-draft" ? (
                    <section
                      key={`layer-draft-${index}`}
                      className="ai-turn-card"
                      data-testid="ai-card-layer-draft"
                    >
                      <p className="ai-turn-card-head">{card.title}</p>
                      <p className="ai-turn-card-note">
                        {Math.min(card.featureCount, 100)} míst ze zdrojů, které odpověď cituje.
                        Nový výběr nahradí předchozí dočasné výsledky.
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
                          onClick={() =>
                            fitResults(card.manifest.source.inline?.features.slice(0, 100) ?? [])
                          }
                        >
                          Přiblížit výsledky
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
                            ? t("ai.layerDraft.saved")
                            : t("ai.layerDraft.save")}
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
                      ...new Map(turn.sources.map((source) => [source.sourceId, source])).values()
                    ].map((source) =>
                      source.url && /^https?:\/\//.test(source.url) ? (
                        <a key={source.sourceId} href={source.url} target="_blank" rel="noreferrer">
                          {source.label}
                        </a>
                      ) : (
                        <Chip key={source.sourceId} label={source.label} />
                      )
                    )}
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
