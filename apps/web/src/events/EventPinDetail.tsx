import { useEffect, useState } from "react";
import { assertEventDocumentV2, type EventDocumentV2 } from "@mapos/layer-sdk";
import { API_BASE } from "../lib/api";
import { emit } from "../lib/events";
import { createSavedPlaceFromFeature } from "../lib/savedPlaces";
import { getMapStore, type SelectedPin } from "../store/mapStore";
import { getShellStore } from "../store/shellStore";
import { useShellStoreSnapshot } from "../store/useShellStoreSnapshot";
import { PanelShell } from "../ui/PanelShell";
import { Button, Chip, InlineNotice, Section } from "../ui/kit";
import { PlaceAction, PlaceActionOverflow, PlaceActionRow } from "../ui/place/PlaceActionRow";
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

/** The one line that answers "should I go": when, where, how much (§4.10). */
function eventHeadline(event: EventDocumentV2): string {
  return [eventTime(event), event.venue.name, price(event)].filter(Boolean).join(" · ");
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
  const shell = getShellStore();
  const leftContext = useShellStoreSnapshot((state) => state.leftContext);
  const [event, setEvent] = useState<EventDocumentV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

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
        ? "Událost je uložená v Osobní"
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
      store.selectPin(null);
      store.setMode("planning");
      store.showToast("Vznikl nový plán s datovanou událostí");
    } catch {
      store.showToast("Událost se nepodařilo přidat do plánu");
    }
  };

  const ticketUrl = event?.ticketUrl ?? event?.ticketOffers?.[0]?.url;
  const officialUrl = event?.officialUrl ?? undefined;
  const fallbackTitle = String(pin.feature.properties.name ?? "Událost");
  const returnTo = leftContext.type === "feature" ? leftContext.returnTo : undefined;

  const facts: [string, string][] = event
    ? [
        ["Čas", `${eventTime(event)} (${event.schedule.timezone})`],
        ["Místo", `${event.venue.name}${event.venue.address ? ` · ${event.venue.address}` : ""}`],
        ["Cena", price(event)],
        ...(event.performers?.length
          ? ([["Účinkující", event.performers.map((performer) => performer.name).join(" · ")]] as [
              string,
              string
            ][])
          : []),
        ...(event.organizer ? ([["Pořadatel", event.organizer.name]] as [string, string][]) : []),
        ...(event.schedule.recurrence
          ? ([["Opakování", event.schedule.recurrence]] as [string, string][])
          : []),
        ...(event.ageRestriction
          ? ([["Věkové omezení", event.ageRestriction]] as [string, string][])
          : []),
        ...(event.accessibility?.length
          ? ([["Přístupnost", event.accessibility.join(" · ")]] as [string, string][])
          : [])
      ]
    : [];

  return (
    <PanelShell
      title="Detail události"
      testId="event-pin-detail"
      className="panel-place-detail"
      dismissible
      busy={!event && !error}
      busyLabel={`Načítám ${fallbackTitle}`}
      onBack={
        returnTo && returnTo.type !== "closed" ? () => shell.closeFeatureContext() : undefined
      }
    >
      <header className="place-hero place-hero-plain">
        <div className="place-hero-copy">
          <h3>{event?.title ?? fallbackTitle}</h3>
          <p className="place-hero-meta">{event ? eventHeadline(event) : "Načítám detail…"}</p>
        </div>
      </header>

      {error && (
        <InlineNotice
          tone="warning"
          testId="event-detail-error"
          action={
            <Button variant="text" size="sm" onClick={() => setRetry((value) => value + 1)}>
              Zkusit znovu
            </Button>
          }
        >
          Ověřený detail události není dostupný.
        </InlineNotice>
      )}

      {event && (
        <>
          <PlaceActionRow>
            {ticketUrl && (
              <PlaceAction
                icon="confirmation_number"
                label="Vstupenky"
                primary
                testId="event-tickets"
                onClick={() => window.open(ticketUrl, "_blank", "noreferrer")}
              />
            )}
            <PlaceAction
              icon="add_location"
              label="Do plánu"
              testId="add-event-to-plan"
              onClick={addToPlan}
            />
            <PlaceAction
              icon="bookmark"
              label="Uložit"
              testId="save-event"
              onClick={() => void save()}
            />
            <PlaceAction
              icon="share"
              label="Sdílet"
              testId="share-event"
              onClick={() => void share()}
            />
            {officialUrl && (
              <PlaceActionOverflow
                actions={[
                  {
                    id: "official",
                    label: "Otevřít u pořadatele",
                    icon: "open_in_new",
                    onSelect: () => window.open(officialUrl, "_blank", "noreferrer")
                  }
                ]}
              />
            )}
          </PlaceActionRow>

          <Chip label={statusLabel(event.status)} icon="event" />

          {event.description && <p>{event.description}</p>}

          <dl className="info-facts event-facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          {event.notes && <p className="event-notes">{event.notes}</p>}

          <Section title="Zdroje">
            <ul className="event-source-list">
              {event.sources.map((source) => (
                <li key={`${source.providerId}:${source.sourceId}`}>
                  <span>{source.attribution ?? source.providerId}</span>
                  <small>ověřeno {new Date(source.retrievedAt).toLocaleString("cs-CZ")}</small>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </PanelShell>
  );
}
