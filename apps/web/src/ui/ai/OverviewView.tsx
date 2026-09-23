import { t } from "../../i18n";
import { getShellStore } from "../../store/shellStore";
import { evidenceDocumentKey, overviewCitationIds } from "./overviewCitations";
import { apiPost } from "../../lib/api";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { OverviewRequest, OverviewResult } from "@mapos/layer-sdk";
import { overviewSession } from "./overviewSession";
import { Button, InlineNotice } from "../kit";
import { getMapStore } from "../../store/mapStore";
import { answerResultManifest, answerBounds } from "../../layers/aiMapResults";
import { emit } from "../../lib/events";

/** Stable section keys and citation IDs; no map writes are tied to text updates. */
export function OverviewView({
  request: initialRequest,
  localFacts,
  savedSnapshot,
  autoStart = false
}: {
  request: OverviewRequest;
  localFacts?: string;
  savedSnapshot?: OverviewResult;
  /** Runs the overview once on mount instead of waiting for the start button. */
  autoStart?: boolean;
}) {
  const [web, setWeb] = useState(initialRequest.web === true);
  const request = useMemo(() => ({ ...initialRequest, web }), [initialRequest, web]);
  const key = JSON.stringify(request);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [key]);
  const session = useMemo(() => overviewSession(request), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (savedSnapshot) session.hydrate(savedSnapshot);
  }, [session, savedSnapshot]);
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    if (!savedSnapshot) void session.start(false);
  }, [autoStart, session, savedSnapshot]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const [shown, setShown] = useState<OverviewResult | undefined>(state.snapshot);
  const container = useRef<HTMLElement>(null);
  const targetKey = JSON.stringify(request.target);
  const previousTarget = useRef(targetKey);
  useEffect(() => {
    const apply = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && container.current?.contains(selection.anchorNode))
        return;
      if (state.snapshot || previousTarget.current !== targetKey) setShown(state.snapshot);
      previousTarget.current = targetKey;
    };
    apply();
    document.addEventListener("selectionchange", apply);
    return () => document.removeEventListener("selectionchange", apply);
  }, [state.snapshot, targetKey]);
  const displayedMap = useRef<{ target: string; revision: string; layerId: string } | undefined>(
    undefined
  );
  const showOnMap = (snapshot: OverviewResult) => {
    const layerId = getMapStore().showAnswerResults(
      answerResultManifest(
        "Místa přehledu",
        snapshot.mapRefs.map((ref) => ({
          id: ref.featureId,
          sourceFeatureId: ref.featureId,
          layerId: ref.layerId,
          title: ref.title,
          category: "poi",
          longitude: ref.lng,
          latitude: ref.lat,
          sourceId: ref.evidenceIds[0]!
        })),
        snapshot.sources.map((e) => ({ sourceId: e.id, label: e.label, url: e.url }))
      )
    );
    displayedMap.current = {
      target: snapshot.targetKey,
      revision: snapshot.geometryRevision,
      layerId
    };
  };
  useEffect(() => {
    const current = displayedMap.current;
    if (
      shown &&
      current?.target === shown.targetKey &&
      current.revision !== shown.geometryRevision &&
      getMapStore().currentAnswerLayerId === current.layerId
    )
      showOnMap(shown);
    // Text/source/citation updates never touch geometry. A new answer cannot replace another view's results.
  }, [shown?.targetKey, shown?.geometryRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  const sourceById = new Map(shown?.sources.map((source) => [source.id, source]));
  const mapRefs = shown?.mapRefs ?? [];
  const long =
    (shown?.sections.reduce(
      (sum, section) => sum + section.claims.reduce((size, claim) => size + claim.text.length, 0),
      0
    ) ?? 0) > 1000;
  return (
    <section ref={container} className="place-brief" data-testid="ai-overview">
      <p className="place-brief-head">
        {shown?.composition === "model-assisted" ? t("polish.aiAssisted") : t("polish.aiHead")}
      </p>
      {request.target.type === "poi" ? (
        <p className="meta">{t("polish.aiStable")}</p>
      ) : (
        <p className="meta">
          {request.target.type === "coordinate"
            ? `Vybraný bod · ${request.target.lat.toFixed(4)}, ${request.target.lng.toFixed(4)}`
            : request.target.type === "area"
              ? "Vybraná oblast při otevření přehledu"
              : request.target.type === "viewport"
                ? "Výřez mapy při zadání otázky"
                : "Vybrané místo"}{" "}
          · posun mapy tento přehled nemění
        </p>
      )}

      {!shown?.sections.some((section) => section.claims.length) && localFacts && (
        <p>{localFacts}</p>
      )}
      {!savedSnapshot && (
        <label className="meta">
          {t("polish.aiSources")}{" "}
          <select
            aria-label={t("polish.aiSources")}
            value={web ? "web" : "local"}
            disabled={state.busy}
            onChange={(event) => setWeb(event.target.value === "web")}
          >
            <option value="local">{t("polish.aiLocal")}</option>
            <option value="web" disabled={!request.consent.externalModel}>
              {t("polish.aiWeb")}
            </option>
          </select>
        </label>
      )}
      <div className="ai-turn-card-actions">
        <Button
          variant="tonal"
          size="sm"
          disabled={state.busy}
          onClick={() => void session.start(Boolean(shown))}
        >
          {shown ? t("polish.aiRefresh") : t("polish.aiStart")}
        </Button>
        {shown && !state.busy && (
          <Button
            variant="text"
            size="sm"
            icon="bookmark"
            onClick={() => {
              void apiPost(
                "/v2/ai/overview/snapshots",
                { fingerprint: shown.scopeFingerprint },
                { auth: true }
              )
                .then(() => getMapStore().showToast("Přehled uložený v osobní sekci AI přehledy."))
                .catch((error) =>
                  getMapStore().showToast(
                    error instanceof Error ? error.message : "Přehled nelze uložit."
                  )
                );
            }}
          >
            Uložit přehled
          </Button>
        )}
        {state.busy && (
          <Button variant="text" size="sm" icon="close" onClick={() => session.stop()}>
            Zastavit
          </Button>
        )}
      </div>
      {state.phase && (
        <p role="status" className="ai-turn-step" data-testid="overview-phase">
          {state.phase}
          {state.snapshot?.sources.length
            ? ` · Zdrojové záznamy: ${new Set(state.snapshot.sources.map(evidenceDocumentKey)).size}`
            : ""}
        </p>
      )}
      {state.error && <InlineNotice tone="warning">{state.error}</InlineNotice>}
      {Boolean(mapRefs.length) && (
        <div className="ai-turn-card-actions">
          <Button
            variant="tonal"
            size="sm"
            onClick={() => {
              if (shown) showOnMap(shown);
            }}
          >
            Zobrazit v mapě
          </Button>
          <Button
            variant="text"
            size="sm"
            onClick={() => {
              const bbox = answerBounds(
                mapRefs.map((ref) => ({ longitude: ref.lng, latitude: ref.lat }))
              );
              if (bbox) emit("fit-bounds", { bbox });
            }}
          >
            Přiblížit
          </Button>
          <Button
            variant="text"
            size="sm"
            onClick={() => {
              displayedMap.current = undefined;
              getMapStore().hideAnswerResults();
            }}
          >
            Skrýt
          </Button>
        </div>
      )}
      {shown?.sections.map((section) => (
        <section
          key={section.id}
          hidden={long && ["facts", "local-index"].includes(section.id) && !expanded}
          data-testid={`overview-${section.id}`}
        >
          <p className="ai-turn-card-head">{section.title}</p>
          {section.claims.map((claim) => (
            <p key={claim.id}>
              {claim.support === "visitor-report" && <strong>Návštěvnické hlášení: </strong>}
              {claim.text}{" "}
              {overviewCitationIds(claim.evidenceIds, sourceById).map((id) => {
                const source = sourceById.get(id);
                return source?.url ? (
                  <a
                    key={id}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Zdroj: ${source.label}`}
                  >
                    [{source.label}]
                  </a>
                ) : (
                  <small key={id}>[{source?.label ?? "Zdroj"}]</small>
                );
              })}
              {claim.limitation && <small> · {claim.limitation}</small>}
              {claim.period && <small> · čas údaje {claim.period}</small>}
            </p>
          ))}
        </section>
      ))}
      {long && shown?.sections.some((s) => ["facts", "local-index"].includes(s.id)) && (
        <Button variant="text" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Skrýt delší vysvětlení" : "Detail odpovědi"}
        </Button>
      )}
      {shown &&
        !state.busy &&
        request.target.type === "area" &&
        getMapStore().areaSelection?.id === request.target.areaId &&
        getMapStore().areaSelection?.revision === request.target.boundaryRevision &&
        request.consent.externalModel && (
          <div className="ai-turn-card-actions">
            {shown.sources.some((s) => s.topic === "highlights") && (
              <Button
                variant="text"
                size="sm"
                onClick={() => getShellStore().openAiContext("Co je zajímavého v této oblasti?")}
              >
                Zeptat se na zajímavosti
              </Button>
            )}
            {shown.sources.some((s) => s.topic === "statistics") && (
              <Button
                variant="text"
                size="sm"
                onClick={() =>
                  getShellStore().openAiContext("Jaké jsou dostupné statistiky této oblasti?")
                }
              >
                Zeptat se na statistiky
              </Button>
            )}
          </div>
        )}
      {shown?.sources.some((source) => source.kind === "document") && (
        <details>
          <summary>Další webové podklady · shoda s místem zatím neověřená</summary>
          {shown.sources
            .filter((source) => source.kind === "document")
            .map((source) => (
              <p key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.label}
                </a>
                <small> · načteno {new Date(source.retrievedAt).toLocaleDateString()}</small>
              </p>
            ))}
        </details>
      )}
      {shown?.limitations.map((limitation, index) => (
        <p className="ai-turn-card-note" key={`${index}:${limitation}`}>
          {limitation}
        </p>
      ))}
    </section>
  );
}
