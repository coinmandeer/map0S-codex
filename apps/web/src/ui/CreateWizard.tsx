import { useEffect, useState } from "react";
import type { ContentDraft, TripPlan, WizardContentType } from "@mapos/layer-sdk";
import { apiGet, apiPost, apiSend } from "../lib/api";
import { emit } from "../lib/events";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { Sheet } from "./primitives";
import { clearContributionIntent, readContributionProvenance } from "./contributionIntent";

const TYPES: Array<{ id: WizardContentType; label: string; hint: string }> = [
  { id: "place", label: "Místo", hint: "Bod, tip nebo oblíbené místo" },
  { id: "layer", label: "Vrstva", hint: "Kolekce míst a obsahu" },
  { id: "route", label: "Trasa", hint: "Aktuální plán cesty" },
  { id: "task", label: "Task", hint: "Úkol na konkrétním místě" },
  { id: "quest", label: "Quest", hint: "Herní úkol s časem" },
  { id: "event", label: "Událost", hint: "Časovaný obsah v mapě" },
  { id: "post", label: "Post", hint: "Komunitní příspěvek" }
];

const STEPS = ["Typ", "Poloha", "Obsah a čas", "Viditelnost", "Kontrola"];

interface LayerSummary {
  id: string;
  name: string;
  isPublic: number;
}

function initialDraft(
  lng: number,
  lat: number,
  provenance = readContributionProvenance()
): Omit<ContentDraft, "id"> {
  const contribution = provenance?.source === "discover" || provenance?.source === "feed";
  return {
    type: contribution ? "post" : "place",
    name: "",
    description: "",
    geometry: { type: "Point", coordinates: [lng, lat] },
    startsAt: null,
    endsAt: null,
    visibility: contribution ? "public" : "private",
    ...(provenance ? { provenance } : {})
  };
}

export function CreateWizard() {
  const store = getMapStore();
  const view = useMapStoreSnapshot((state) => state.view);
  const activePlan = useMapStoreSnapshot((state) => state.activePlan);
  const route = useMapStoreSnapshot((state) => state.routePreview);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => initialDraft(view.lng, view.lat));
  const isContribution =
    draft.provenance?.source === "discover" || draft.provenance?.source === "feed";
  const [busy, setBusy] = useState(false);
  const [publicConfirmed, setPublicConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    clearContributionIntent();
  }, []);

  const setType = (type: WizardContentType) => {
    setDraft((current) => ({
      ...current,
      type,
      geometry:
        type === "route" && route
          ? { type: "LineString", coordinates: route.coordinates }
          : { type: "Point", coordinates: [view.lng, view.lat] }
    }));
  };

  const valid =
    step === 0 ||
    step === 1 ||
    (step === 2
      ? draft.name.trim().length > 0
      : step === 4
        ? isContribution || draft.visibility !== "public" || publicConfirmed
        : true);

  const saveConcept = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/drafts", draft);
      store.showToast("Soukromý koncept je uložený v Moje");
      store.closeSheet();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Koncept nelze uložit");
    } finally {
      setBusy(false);
    }
  };

  const ensureContentLayer = async (isPublic: boolean) => {
    const name = isPublic ? "MapOS veřejné" : "MapOS soukromé";
    const listed = await apiGet<{ layers: LayerSummary[] }>("/user-layers", { auth: true });
    let layer = listed.layers.find(
      (candidate) => candidate.name === name && Boolean(candidate.isPublic) === isPublic
    );
    if (!layer) {
      const created = await apiPost<{ layer: LayerSummary }>("/user-layers", {
        name,
        color: isPublic ? "#0ea5e9" : "#10b981"
      });
      layer = created.layer;
      if (isPublic) {
        layer = (
          await apiSend<{ layer: LayerSummary }>("PATCH", `/user-layers/${layer.id}`, {
            isPublic: true
          })
        ).layer;
      }
    }
    return layer.id;
  };

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      if (draft.type === "layer") {
        const created = await apiPost<{ layer: LayerSummary }>("/user-layers", {
          name: draft.name,
          color: "#8b5cf6"
        });
        if (draft.visibility === "public") {
          await apiSend("PATCH", `/user-layers/${created.layer.id}`, { isPublic: true });
        }
      } else if (draft.type === "route") {
        if (!activePlan) throw new Error("Nejdřív vytvoř plán v režimu Plánování");
        const plan: TripPlan = {
          ...activePlan,
          name: draft.name || activePlan.name,
          visibility: draft.visibility
        };
        await apiPost("/plans", plan);
        store.setActivePlan(plan);
      } else {
        if (draft.geometry.type !== "Point") throw new Error("Tento obsah potřebuje bod na mapě");
        const layerId = await ensureContentLayer(draft.visibility === "public");
        const [lng, lat] = draft.geometry.coordinates;
        await apiPost(`/user-layers/${layerId}/pins`, {
          name: draft.name,
          description: draft.description,
          lng,
          lat,
          kind: ["task", "quest", "event"].includes(draft.type) ? "task" : "place",
          properties: {
            contentType: draft.type,
            startsAt: draft.startsAt,
            endsAt: draft.endsAt,
            visibility: draft.visibility
          }
        });
      }
      emit("layers-changed");
      store.showToast(
        draft.visibility === "public" ? "Obsah je publikovaný" : "Soukromý obsah je uložený"
      );
      store.closeSheet();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Publikace se nepodařila");
    } finally {
      setBusy(false);
    }
  };

  const submitForReview = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await apiPost<{ draft: ContentDraft }>("/drafts", draft);
      const submitted = await apiPost<{ draft: ContentDraft }>(
        `/drafts/${created.draft.id}/submit`,
        {}
      );
      store.showToast(
        `Příspěvek · revize ${submitted.draft.workflow?.revision ?? 2} · čeká na kontrolu`
      );
      store.closeSheet();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Příspěvek nelze odeslat ke kontrole");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={
        isContribution
          ? draft.provenance?.source === "feed"
            ? "Nový příspěvek"
            : "Přidat do Objevuj"
          : "Vytvořit"
      }
      onClose={() => store.closeSheet()}
      testId="create-wizard"
    >
      {isContribution && (
        <section className="wizard-contribution" data-testid="wizard-contribution">
          <span aria-hidden="true">◎</span>
          <div>
            <strong>Místní znalost s dohledatelným původem</strong>
            <p>
              {draft.provenance?.sourceLabel}. MapOS doplní autora, číslo revize a stav kontroly.
              Koncept se bez schválení nezveřejní.
            </p>
          </div>
        </section>
      )}
      <div className="wizard-progress" aria-label="Průběh">
        {STEPS.map((label, index) => (
          <span key={label} className={index === step ? "active" : index < step ? "done" : ""}>
            {index + 1}
          </span>
        ))}
      </div>
      <p className="wizard-step-name">{STEPS[step]}</p>

      {step === 0 && (
        <div className="wizard-types">
          {TYPES.map((type) => (
            <button
              key={type.id}
              type="button"
              className={draft.type === type.id ? "active" : ""}
              onClick={() => setType(type.id)}
            >
              <strong>{type.label}</strong>
              <span>{type.hint}</span>
            </button>
          ))}
        </div>
      )}

      {step === 1 && (
        <div className="wizard-pane">
          <p className="meta">
            {draft.geometry.type === "LineString"
              ? `Aktuální trasa · ${draft.geometry.coordinates.length} bodů`
              : "Bod na mapě"}
          </p>
          {draft.geometry.type === "Point" && (
            <>
              <div className="wizard-coordinates">
                <input
                  aria-label="Zeměpisná délka"
                  type="number"
                  step="0.0001"
                  value={draft.geometry.coordinates[0]}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      geometry: {
                        type: "Point",
                        coordinates: [
                          Number(event.target.value),
                          draft.geometry.type === "Point" ? draft.geometry.coordinates[1] : view.lat
                        ]
                      }
                    })
                  }
                />
                <input
                  aria-label="Zeměpisná šířka"
                  type="number"
                  step="0.0001"
                  value={draft.geometry.coordinates[1]}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      geometry: {
                        type: "Point",
                        coordinates: [
                          draft.geometry.type === "Point"
                            ? draft.geometry.coordinates[0]
                            : view.lng,
                          Number(event.target.value)
                        ]
                      }
                    })
                  }
                />
              </div>
              <button
                className="btn block"
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    geometry: { type: "Point", coordinates: [view.lng, view.lat] }
                  })
                }
              >
                Použít střed mapy
              </button>
            </>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="wizard-pane">
          <label className="planner-field">
            <span>Název</span>
            <input
              autoFocus
              value={draft.name}
              maxLength={180}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label className="planner-field">
            <span>Popis</span>
            <textarea
              rows={4}
              value={draft.description}
              maxLength={4000}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          {["task", "quest", "event", "post"].includes(draft.type) && (
            <div className="planner-grid two">
              <label className="planner-field">
                <span>Začátek</span>
                <input
                  type="datetime-local"
                  value={draft.startsAt?.slice(0, 16) ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      startsAt: event.target.value
                        ? new Date(event.target.value).toISOString()
                        : null
                    })
                  }
                />
              </label>
              <label className="planner-field">
                <span>Konec</span>
                <input
                  type="datetime-local"
                  value={draft.endsAt?.slice(0, 16) ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      endsAt: event.target.value ? new Date(event.target.value).toISOString() : null
                    })
                  }
                />
              </label>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <>
          {isContribution ? (
            <div className="wizard-review-flow" data-testid="wizard-review-flow">
              <div className="active">
                <span>1</span>
                <strong>Koncept</strong>
                <small>Soukromě rozepsaný</small>
              </div>
              <div>
                <span>2</span>
                <strong>Kontrola</strong>
                <small>Původ, obsah a poloha</small>
              </div>
              <div>
                <span>3</span>
                <strong>Zveřejnění</strong>
                <small>Po schválení</small>
              </div>
            </div>
          ) : (
            <div className="wizard-types visibility">
              {(["private", "unlisted", "public"] as const).map((visibility) => (
                <button
                  key={visibility}
                  type="button"
                  className={draft.visibility === visibility ? "active" : ""}
                  onClick={() => {
                    setDraft({ ...draft, visibility });
                    setPublicConfirmed(false);
                  }}
                >
                  <strong>
                    {visibility === "private"
                      ? "Soukromé"
                      : visibility === "unlisted"
                        ? "Neveřejné"
                        : "Veřejné"}
                  </strong>
                  <span>
                    {visibility === "private"
                      ? "Jen v tvém profilu"
                      : visibility === "unlisted"
                        ? "Jen s přímým odkazem"
                        : "Viditelné komunitě ihned"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {step === 4 && (
        <div className="wizard-pane wizard-review">
          <h3>{draft.name || "Bez názvu"}</h3>
          <p>
            {TYPES.find((type) => type.id === draft.type)?.label} · {draft.visibility}
          </p>
          <p className="meta">{draft.description || "Bez popisu"}</p>
          {isContribution && (
            <dl className="wizard-provenance">
              <div>
                <dt>Původ</dt>
                <dd>{draft.provenance?.sourceLabel}</dd>
              </div>
              <div>
                <dt>Stav po odeslání</dt>
                <dd>Revize 2 · čeká na kontrolu</dd>
              </div>
              <div>
                <dt>Autor</dt>
                <dd>Doplní přihlášená relace</dd>
              </div>
            </dl>
          )}
          {draft.visibility === "public" && !isContribution && (
            <label className="wizard-confirm">
              <input
                type="checkbox"
                checked={publicConfirmed}
                onChange={(event) => setPublicConfirmed(event.target.checked)}
              />
              <span>Rozumím, že guest obsah bude po publikaci okamžitě veřejný.</span>
            </label>
          )}
        </div>
      )}

      {error && (
        <p className="planner-error" role="alert">
          {error}
        </p>
      )}
      <div className="wizard-actions">
        {step > 0 && (
          <button className="btn" type="button" disabled={busy} onClick={() => setStep(step - 1)}>
            Zpět
          </button>
        )}
        <button
          className="btn btn-ghost"
          type="button"
          disabled={busy}
          onClick={() => void saveConcept()}
        >
          Uložit koncept
        </button>
        {step < STEPS.length - 1 ? (
          <button
            className="btn btn-accent"
            type="button"
            disabled={!valid}
            onClick={() => setStep(step + 1)}
          >
            Pokračovat
          </button>
        ) : (
          <button
            className="btn btn-accent"
            data-testid="wizard-publish"
            type="button"
            disabled={!valid || busy}
            onClick={() => void (isContribution ? submitForReview() : publish())}
          >
            {busy
              ? "Ukládám…"
              : isContribution
                ? "Odeslat ke kontrole"
                : draft.visibility === "public"
                  ? "Publikovat"
                  : "Uložit"}
          </button>
        )}
      </div>
    </Sheet>
  );
}
