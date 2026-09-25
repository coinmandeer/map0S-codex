import { presentationLabel } from "../i18n/presentation";
import { useEffect, useMemo, useRef, useState } from "react";
import { featureAnchor, type GeoFeature, type MapViewState } from "@mapos/layer-sdk";
import { emit } from "../lib/events";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { Icon } from "../ui/primitives";
import { buildEventExplorerItems } from "./eventExplorer";
import {
  eventFilterPatch,
  eventRangeFromFilters,
  eventRangePresets,
  startOfLocalDay
} from "./timeline";
import { intlLocale, t } from "../i18n";

const EVENT_CATEGORIES = [
  ["Music", "Hudba"],
  ["Sports", "Sport"],
  ["Arts & Theatre", "Umění a divadlo"],
  ["Family", "Rodina"],
  ["community", "Komunita"]
] as const;
const EMPTY_EVENT_FEATURES: GeoFeature[] = [];

function eventTime(value: string | null): { day: string; rest: string } {
  if (!value) return { day: "—", rest: t("polish.eventTimeUnknown") };
  const date = new Date(value);
  return {
    day: date.toLocaleDateString(intlLocale(), { day: "2-digit" }),
    rest: date.toLocaleString(intlLocale(), {
      month: "short",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit"
    })
  };
}

function distanceLabel(value: number): string {
  return value < 1_000
    ? `${Math.round(value)} m`
    : `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} km`;
}

export function EventExplorerPanel({ view }: { view: MapViewState }) {
  const store = getMapStore();
  const active = useMapStoreSnapshot((state) => state.activeLayers);
  const features =
    useMapStoreSnapshot((state) => state.visibleFeatures.events) ?? EMPTY_EVENT_FEATURES;
  const loading = useMapStoreSnapshot((state) => Boolean(state.loadingLayers.events));
  const filters = active.events?.filters ?? {};
  const base = useRef(startOfLocalDay(new Date()));
  const [distance, setDistance] = useState("all");
  const [venueDraft, setVenueDraft] = useState(
    typeof filters.venue === "string" ? filters.venue : ""
  );

  useEffect(() => {
    setVenueDraft(typeof filters.venue === "string" ? filters.venue : "");
  }, [filters.venue]);

  const items = useMemo(
    () =>
      buildEventExplorerItems(features, view, distance === "all" ? null : Number(distance)).slice(
        0,
        24
      ),
    [distance, features, view]
  );
  const timePresets = useMemo(() => eventRangePresets(base.current), []);
  const activeRange = eventRangeFromFilters(filters, base.current);

  const patchFacet = (key: string, value: string | boolean | undefined) => {
    const next = { ...filters };
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    store.setLayerFilters("events", next);
  };

  const resetFacets = () => {
    const next = { ...filters };
    for (const key of ["category", "status", "source", "free", "venue"]) delete next[key];
    setDistance("all");
    setVenueDraft("");
    store.setLayerFilters("events", next);
  };

  const hasFacets = ["category", "status", "source", "free", "venue"].some(
    (key) => filters[key] !== undefined
  );

  const openEvent = (feature: (typeof features)[number]) => {
    const [lng, lat] = featureAnchor(feature);
    emit("fly-to", { lng, lat, zoom: 15 });
    store.setView({ lng, lat, zoom: 15 });
    store.selectPin({ feature, layerId: "events" });
    if (window.innerWidth < 900) store.setSidebarOpen(false);
  };

  return (
    <section
      className="event-explorer"
      data-testid="event-explorer"
      aria-labelledby="event-explorer-title"
    >
      <header className="event-explorer-header">
        <span className="event-explorer-mark" aria-hidden="true">
          <Icon name="compass" size={19} />
        </span>
        <div>
          <p className="discover-eyebrow">{t("polish.eventViewport")}</p>
          <h4 id="event-explorer-title">{t("polish.events")}</h4>
        </div>
        <span
          className="event-explorer-count"
          data-testid="event-explorer-count"
          aria-live="polite"
        >
          {items.length === features.length ? items.length : `${items.length}/${features.length}`}
        </span>
      </header>

      <div className="event-explorer-filters" aria-label={t("polish.eventFilters")}>
        <label>
          <span>{t("polish.eventType")}</span>
          <select
            aria-label={t("polish.eventCategory")}
            value={typeof filters.category === "string" ? filters.category : ""}
            onChange={(event) => patchFacet("category", event.target.value)}
          >
            <option value="">{t("polish.eventAll")}</option>
            {EVENT_CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>
                {presentationLabel("event", value, label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("polish.eventPrice")}</span>
          <select
            aria-label={t("polish.eventPriceLabel")}
            value={
              filters.free === true || filters.free === "true"
                ? "true"
                : filters.free === false || filters.free === "false"
                  ? "false"
                  : ""
            }
            onChange={(event) =>
              patchFacet(
                "free",
                event.target.value === "" ? undefined : event.target.value === "true"
              )
            }
          >
            <option value="">{t("polish.eventAny")}</option>
            <option value="true">{t("polish.eventFree")}</option>
            <option value="false">{t("polish.eventPaid")}</option>
          </select>
        </label>
        <label>
          <span>{t("polish.eventDistance")}</span>
          <select
            aria-label={t("polish.eventDistanceLabel")}
            value={distance}
            onChange={(event) => setDistance(event.target.value)}
          >
            <option value="all">{t("polish.eventWholeView")}</option>
            <option value="5">{t("polish.eventWithin", { count: 5 })}</option>
            <option value="25">{t("polish.eventWithin", { count: 25 })}</option>
            <option value="100">{t("polish.eventWithin", { count: 100 })}</option>
          </select>
        </label>
        <label className="event-explorer-venue">
          <span>{t("polish.eventVenue")}</span>
          <input
            type="search"
            aria-label={t("polish.eventVenueFilter")}
            placeholder={t("polish.eventVenueName")}
            value={venueDraft}
            onChange={(event) => {
              setVenueDraft(event.target.value);
              patchFacet("venue", event.target.value.trim());
            }}
            onBlur={() => patchFacet("venue", venueDraft.trim())}
            onKeyDown={(event) => {
              if (event.key === "Enter") patchFacet("venue", venueDraft.trim());
            }}
          />
        </label>
      </div>

      <div className="event-explorer-time" aria-label={t("polish.eventQuickTime")}>
        {timePresets.map((preset) => {
          const selected = preset.range[0] === activeRange[0] && preset.range[1] === activeRange[1];
          return (
            <button
              key={preset.id}
              type="button"
              className={`owm-pill${selected ? " active" : ""}`}
              aria-pressed={selected}
              data-testid={`events-explorer-preset-${preset.id}`}
              onClick={() =>
                store.setLayerFilters("events", {
                  ...filters,
                  ...eventFilterPatch(preset.range, base.current)
                })
              }
            >
              {presentationLabel("event", preset.id, preset.label)}
            </button>
          );
        })}
      </div>

      <div className="event-explorer-summary">
        <span>{loading ? t("polish.eventUpdating") : t("polish.eventTimeline")}</span>
        {(hasFacets || distance !== "all") && (
          <button className="btn btn-ghost small" type="button" onClick={resetFacets}>
            {t("polish.reset")}
          </button>
        )}
      </div>

      {items.length ? (
        <ul className="event-explorer-list" aria-label={t("polish.eventResults")}>
          {items.map((item) => {
            const time = eventTime(item.startsAt);
            return (
              <li key={item.id} className="event-explorer-card">
                <button type="button" onClick={() => openEvent(item.feature)}>
                  <span className="event-date-tile" aria-hidden="true">
                    <strong>{time.day}</strong>
                    <small>
                      {item.startsAt
                        ? new Date(item.startsAt).toLocaleDateString(intlLocale(), {
                            month: "short"
                          })
                        : "—"}
                    </small>
                  </span>
                  <span className="event-explorer-copy">
                    <strong>{item.title}</strong>
                    <small>
                      {time.rest}
                      {item.venue ? ` · ${item.venue}` : ""}
                    </small>
                    <span>
                      {item.status} · {item.price} · {distanceLabel(item.distanceM)}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={16} />
                </button>
                {item.officialUrl ? (
                  <a
                    href={item.officialUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={t("polish.eventOpen", { name: item.title })}
                  >
                    {t("polish.eventOfficial")}
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="event-explorer-empty" role="status">
          <strong>{loading ? t("polish.eventSearching") : t("polish.eventEmpty")}</strong>
          <span>{t("polish.eventExpand")}</span>
        </div>
      )}
    </section>
  );
}
