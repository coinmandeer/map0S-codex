import { useEffect, useState } from "react";
import { assertEventDocumentV2, type EventDocumentV2 } from "@mapos/layer-sdk";
import { API_BASE } from "../lib/api";
import { emit } from "../lib/events";
import { createSavedPlaceFromFeature } from "../lib/savedPlaces";
import { getMapStore, type SelectedPin } from "../store/mapStore";
import {
  EVENT_PLAN_DRAFT_STORAGE_KEY,
  addEventToPlan,
  createEventPlanDocument,
  createEventPlanStopDraft
} from "./eventPlanStop";

function statusLabel(status: EventDocumentV2["status"]): string {
  if (status === "cancelled") return "Zrušeno";
  if (status === "postponed") return "Odloženo";
  if (status === "rescheduled") return "Přesunuto";
  if (status === "completed") return "Proběhlo";
  if (status === "unknown") return "Stav neověřen";
  return "Naplánováno";
}

function eventTime(event: EventDocumentV2): string {
  const format = new Intl.DateTimeFormat("cs-CZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: event.schedule.timezone
  });
  const start = format.format(new Date(event.schedule.startsAt));
  const end = event.schedule.endsAt ? format.format(new Date(event.schedule.endsAt)) : null;
  return end ? `${start} – ${end}` : start;
}

function price(event: EventDocumentV2): string {
  if (event.price?.free) return "Zdarma";
  const currency = event.price?.currency ?? "";
  if (event.price?.min != null && event.price?.max != null) {
    return `${event.price.min}–${event.price.max} ${currency}`.trim();
  }
  if (event.price?.min != null) return `od ${event.price.min} ${currency}`.trim();
  return event.price?.note ?? "Cena není uvedena";
}

function localId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${suffix}`;
}

export function EventPinDetail({ pin }: { pin: SelectedPin }) {
  const store = getMapStore();
  const [event, setEvent] = useState<EventDocumentV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [desktop, setDesktop] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 900 : false
  );

  useEffect(() => {
    const resize = () => setDesktop(window.innerWidth >= 900);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setEvent(null);
    setError(null);
    void fetch(`${API_BASE}/v2/events/${encodeURIComponent(pin.feature.properties.id)}`, {
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`event detail ${response.status}`);
        return response.json() as Promise<{ event?: unknown }>;
      })
      .then((result) => {
        assertEventDocumentV2(result.event);
        setEvent(result.event);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Detail události není dostupný");
        }
      });
    return () => controller.abort();
  }, [pin.feature.properties.id, retry]);

  const save = async () => {
    const result = await createSavedPlaceFromFeature(pin.feature, pin.layerId);
    if (result === "auth") {
      store.openSheet("auth");
      store.showToast("Přihlas se pro uložení události");
      return;
    }
    if (result === "ok") emit("layers-changed");
    store.showToast(
      result === "ok"
        ? "Událost je uložená v Personal"
        : result === "exists"
          ? "Událost už máš uloženou"
          : "Uložení se nepovedlo"
    );
  };

  const share = async () => {
    if (!event) return;
    const text = `${event.title}\n${eventTime(event)}\n${event.venue.name}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: event.title, text, url: window.location.href });
      } else {
        await navigator.clipboard.writeText(`${text}\n${window.location.href}`);
        store.showToast("Odkaz na událost je zkopírovaný");
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      store.showToast("Sdílení se nepodařilo");
    }
  };

  const addToPlan = () => {
    if (!event) return;
    try {
      const current = store.activePlanDocument;
      if (current) {
        if (current.stops.length >= 250) {
          store.showToast("Interaktivní plán už má 250 zastávek");
          return;
        }
        const result = addEventToPlan(current, event, {
          commandId: localId("event-command"),
          stopId: localId("event-stop")
        });
        if (!result.added) {
          store.showToast("Událost už v plánu je");
          return;
        }
        store.setActivePlanDocument(result.plan);
        store.showToast("Událost je přidaná do rozpracovaného plánu");
        return;
      }

      const draft = createEventPlanStopDraft(event);
      window.sessionStorage.setItem(EVENT_PLAN_DRAFT_STORAGE_KEY, JSON.stringify(draft));
      store.setActivePlanDocument(
        createEventPlanDocument(event, { id: localId("event-plan"), now: draft.createdAt })
      );
      store.closeSheet();
      store.setMode("planning");
      store.showToast("Vznikl nový plán s datovanou událostí");
    } catch {
      store.showToast("Událost se nepodařilo přidat do plánu");
    }
  };

  const fallbackTitle = String(pin.feature.properties.name ?? "Událost");

  return (
    <>
      <div className="overlay" onClick={() => store.closeSheet()} />
      <div
        className={`panel ${desktop ? "dialog" : "sheet"} event-detail`}
        data-testid="event-pin-detail"
      >
        {!desktop && <div className="panel-handle" />}
        <div className="panel-header">
          <h2>Detail události</h2>
          <button className="btn btn-ghost" type="button" onClick={() => store.closeSheet()}>
            ✕
          </button>
        </div>
        <div className="panel-body">
          {!event && !error ? (
            <p className="meta" aria-live="polite">
              Načítám {fallbackTitle}…
            </p>
          ) : null}
          {error ? (
            <div className="detail-load-state error" role="status">
              <span>Ověřený detail události není dostupný.</span>
              <button
                className="btn small"
                type="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Zkusit znovu
              </button>
            </div>
          ) : null}
          {event ? (
            <article className="event-detail-content">
              <header>
                <span className={`event-status status-${event.status}`}>
                  {statusLabel(event.status)}
                </span>
                <h3>{event.title}</h3>
                {event.description ? <p>{event.description}</p> : null}
              </header>

              <dl className="info-facts event-facts">
                <div>
                  <dt>Čas</dt>
                  <dd>{eventTime(event)}</dd>
                </div>
                <div>
                  <dt>Časové pásmo</dt>
                  <dd>{event.schedule.timezone}</dd>
                </div>
                <div>
                  <dt>Místo</dt>
                  <dd>
                    {event.venue.name}
                    {event.venue.address ? ` · ${event.venue.address}` : ""}
                  </dd>
                </div>
                {event.performers?.length ? (
                  <div>
                    <dt>Účinkující</dt>
                    <dd>{event.performers.map((performer) => performer.name).join(" · ")}</dd>
                  </div>
                ) : null}
                {event.organizer ? (
                  <div>
                    <dt>Pořadatel</dt>
                    <dd>{event.organizer.name}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Cena</dt>
                  <dd>{price(event)}</dd>
                </div>
                {event.schedule.recurrence ? (
                  <div>
                    <dt>Opakování</dt>
                    <dd>{event.schedule.recurrence}</dd>
                  </div>
                ) : null}
                {event.ageRestriction ? (
                  <div>
                    <dt>Věkové omezení</dt>
                    <dd>{event.ageRestriction}</dd>
                  </div>
                ) : null}
                {event.accessibility?.length ? (
                  <div>
                    <dt>Přístupnost</dt>
                    <dd>{event.accessibility.join(" · ")}</dd>
                  </div>
                ) : null}
              </dl>

              {event.notes ? <p className="event-notes">{event.notes}</p> : null}

              <section className="event-source-list" aria-label="Zdroje a čerstvost">
                <h4>Zdroje</h4>
                <ul>
                  {event.sources.map((source) => (
                    <li key={`${source.providerId}:${source.sourceId}`}>
                      <span>{source.attribution ?? source.providerId}</span>
                      <small>ověřeno {new Date(source.retrievedAt).toLocaleString("cs-CZ")}</small>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="pin-actions">
                <button
                  className="btn"
                  type="button"
                  data-testid="save-event"
                  onClick={() => void save()}
                >
                  Uložit
                </button>
                <button
                  className="btn"
                  type="button"
                  data-testid="share-event"
                  onClick={() => void share()}
                >
                  Sdílet
                </button>
                <button
                  className="btn btn-accent"
                  type="button"
                  data-testid="add-event-to-plan"
                  onClick={addToPlan}
                >
                  Přidat do plánu
                </button>
                {(event.ticketUrl ?? event.ticketOffers?.[0]?.url) ? (
                  <a
                    className="btn"
                    href={event.ticketUrl ?? event.ticketOffers?.[0]?.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Vstupenky
                  </a>
                ) : null}
                {event.officialUrl ? (
                  <a
                    className="btn btn-ghost"
                    href={event.officialUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Otevřít poskytovatele
                  </a>
                ) : null}
              </div>
            </article>
          ) : null}
        </div>
      </div>
    </>
  );
}
