import { useEffect, useRef, useState } from "react";
import { apiPost } from "../lib/api";
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
  Skeleton,
  TextArea
} from "./kit";

interface AiPlace {
  id: string;
  layerId: string;
  title: string;
  longitude: number;
  latitude: number;
  distanceMeters: number;
  source: { sourceId: string; label: string; url?: string };
}

interface AiAnswer {
  status: "succeeded";
  conversation: { id: string; revision: number; scope: { type: "global" } };
  answer: { text: string; results: AiPlace[] };
}

interface Turn {
  id: string;
  question: string;
  text: string | null;
  places: AiPlace[];
  error: string | null;
}

const PRIVACY_DISMISSED_KEY = "mapos:ai-privacy-ack";

/** The map-wide assistant (§4.13).
 *
 *  One thread over the map: a question goes to the AI gateway with the map centre and the
 *  active POI layer as context, and the places it answers with are cards that fly the map and
 *  open the place detail. The privacy line is shown once and stays dismissed.
 */
export function AiPanel() {
  const store = getMapStore();
  const shell = getShellStore();
  const leftContext = useShellStoreSnapshot((state) => state.leftContext);
  const view = useMapStoreSnapshot((state) => state.view);
  const activeLayers = useMapStoreSnapshot((state) => state.activeLayers);
  const units = useMapStoreSnapshot((state) => state.preferences.units);
  const seeded = leftContext.type === "ai" ? leftContext.prompt : undefined;

  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [privacyAck, setPrivacyAck] = useState(
    () =>
      typeof window !== "undefined" && window.localStorage.getItem(PRIVACY_DISMISSED_KEY) === "1"
  );
  const askedSeed = useRef<string | null>(null);

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    const id = `turn-${Date.now()}`;
    setBusy(true);
    setTurns((current) => [
      ...current,
      { id, question: trimmed, text: null, places: [], error: null }
    ]);
    setPrompt("");
    try {
      const response = await apiPost<AiAnswer>("/v2/ai/orchestrate", {
        prompt: trimmed,
        conversation: { mode: "new", scope: { type: "global" } },
        reference: { source: "map-center", longitude: view.lng, latitude: view.lat },
        activeLayerIds: Object.entries(activeLayers)
          .filter(([, state]) => state.visible)
          .map(([layerId]) => layerId),
        activeFilters: {},
        radiusMeters: 10_000,
        limit: 6,
        preciseLocationConsent: false
      });
      setTurns((current) =>
        current.map((turn) =>
          turn.id === id
            ? { ...turn, text: response.answer.text, places: response.answer.results }
            : turn
        )
      );
    } catch (cause) {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === id
            ? {
                ...turn,
                error:
                  cause instanceof Error
                    ? cause.message
                    : "Odpověď se nepodařilo získat. Zkus dotaz zopakovat."
              }
            : turn
        )
      );
    } finally {
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
            icon="delete"
            label="Vymazat konverzaci"
            size="sm"
            testId="ai-panel-clear"
            onClick={() => setTurns([])}
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
          <TextArea
            label="Na co se chceš zeptat?"
            rows={2}
            maxLength={2_000}
            value={prompt}
            placeholder="Např. kde je poblíž klidný kemp u vody?"
            onChange={(event) => setPrompt(event.target.value)}
          />
          <Button
            type="submit"
            variant="filled"
            icon="send"
            block
            loading={busy}
            disabled={busy || !prompt.trim()}
            testId="ai-panel-send"
          >
            Odeslat
          </Button>
        </form>
      }
    >
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
            ) : turn.text === null ? (
              <Skeleton height={12} count={3} />
            ) : (
              <>
                <p className="ai-turn-answer">{turn.text}</p>
                {turn.places.length > 0 && (
                  <div className="ai-turn-places">
                    {turn.places.map((place, index) => (
                      <ListItem
                        key={place.id}
                        title={`${index + 1}. ${place.title}`}
                        subtitle={`${formatDistance(place.distanceMeters, units)} · ${place.source.label}`}
                        icon="place"
                        ariaLabel={`Otevřít detail místa ${place.title}`}
                        onClick={() => openPlace(place)}
                      />
                    ))}
                  </div>
                )}
                <div className="ai-turn-sources">
                  {[...new Set(turn.places.map((place) => place.source.label))].map((label) => (
                    <Chip key={label} label={label} />
                  ))}
                </div>
              </>
            )}
          </article>
        ))}
      </div>
    </PanelShell>
  );
}
