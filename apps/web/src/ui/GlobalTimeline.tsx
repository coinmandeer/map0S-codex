import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { API_BASE } from "../lib/api";
import { on, type MapOsEvents } from "../lib/events";
import { getLayerManifestV2 } from "../layers/registry";
import {
  resolveWeatherVisualization,
  weatherVisualizationOption
} from "../layers/weather/controls";
import { paletteFor, rampCssGradient } from "../layers/weather/palettes";
import { WEATHER_RUNTIME_BUDGET } from "../layers/weather/strategy";
import { filterPatchChanges, weatherTimelinePatch } from "../layers/weather/timeline";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { EventTimelineContribution } from "../events/EventTimelineContribution";
import { timelineContributions } from "./footerContributions";
import { Chip, IconButton } from "./kit";
import { MapTimeline } from "./MapTimeline";

const HOUR_MS = 3_600_000;
const MIN_HOUR = -24;
const MAX_HOUR = 168;

interface GridStats {
  variable: string;
  unit: string;
  median: number;
  min: number;
  max: number;
  sampleCount: number;
  validAt: string;
  representation: "continuous-grid" | "cells" | "numeric-sectors";
  renderedCount: number;
  targetCellAreaKm2: 50 | 20 | 10;
}

function floorHour(date: Date): Date {
  const result = new Date(date);
  result.setMinutes(0, 0, 0);
  return result;
}

function formatCursor(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("cs-CZ", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatValue(value: number): string {
  const precision = Math.abs(value) < 10 ? 1 : 0;
  return value.toFixed(precision);
}

/** Day labels positioned along the scrubber, at local midnight. */
function dayTicks(base: Date): { offset: number; percent: number; label: string }[] {
  const span = MAX_HOUR - MIN_HOUR;
  const ticks: { offset: number; percent: number; label: string }[] = [];
  for (let offset = MIN_HOUR; offset <= MAX_HOUR; offset += 1) {
    const date = new Date(base.getTime() + offset * HOUR_MS);
    if (date.getHours() !== 0) continue;
    ticks.push({
      offset,
      percent: ((offset - MIN_HOUR) / span) * 100,
      label: date.toLocaleDateString("cs-CZ", { weekday: "short" })
    });
  }
  return ticks;
}

function representationLabel(representation: GridStats["representation"]): string {
  if (representation === "continuous-grid") return "regionální pole";
  if (representation === "cells") return "adaptivní buňky";
  return "lokální sektory";
}

/** The sole map timeline lifecycle. AppShell keeps importing `GlobalTimeline` as a compatibility
 * name, while every temporal layer/dated plan contributes to this one host. */
export function TimelineHost() {
  const store = getMapStore();
  const active = useMapStoreSnapshot((state) => state.activeLayers);
  const temporal = useMapStoreSnapshot((state) => state.temporal);
  const activePlan = useMapStoreSnapshot((state) => state.activePlan);
  const baseHour = useRef(floorHour(new Date()));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(0);
  const committedOffsetRef = useRef(Number.NaN);
  const [playing, setPlaying] = useState(false);
  const [frames, setFrames] = useState<number[]>([]);
  const [stats, setStats] = useState<GridStats | null>(null);
  const [mapDetail, setMapDetail] = useState<MapOsEvents["weather-cell-selected"] | null>(null);

  const contributions = useMemo(
    () => timelineContributions(active, activePlan, getLayerManifestV2),
    [active, activePlan]
  );
  const weatherOn = contributions.some(({ id }) => id === "layer:weather");
  const eventsOn = contributions.some(({ id }) => id === "layer:events");
  const cursorOn = weatherOn || contributions.some(({ kind }) => kind === "dated-plan");
  const weatherFilters = active.weather?.filters ?? {};
  const visualization = resolveWeatherVisualization(weatherFilters);
  const cursorMs = new Date(temporal.cursor).getTime();
  const offset = Math.max(
    MIN_HOUR,
    Math.min(MAX_HOUR, Math.round((cursorMs - baseHour.current.getTime()) / HOUR_MS))
  );
  const [draftOffset, setDraftOffset] = useState(offset);
  const future = cursorMs > Date.now() + 30 * 60_000;

  useEffect(() => {
    draftRef.current = offset;
    committedOffsetRef.current = offset;
    setDraftOffset(offset);
  }, [offset]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  useEffect(() => on("weather-grid-updated", setStats), []);
  useEffect(() => on("weather-cell-selected", setMapDetail), []);

  useEffect(() => {
    if (!weatherOn || visualization !== "radar") {
      setFrames([]);
      return;
    }
    const controller = new AbortController();
    void fetch(`${API_BASE}/weather/frames`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { frames: [] }))
      .then((data: { frames?: number[] }) => setFrames(data.frames ?? []))
      .catch(() => {
        if (!controller.signal.aborted) setFrames([]);
      });
    return () => controller.abort();
  }, [weatherOn, visualization]);

  // Playback walks the same cursor the scrubber writes, one hour at a time, so every layer
  // follows without knowing that anything is playing.
  useEffect(() => {
    if (!playing) return;
    if (offset >= MAX_HOUR) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => {
      store.setTimeCursor(new Date(baseHour.current.getTime() + (offset + 1) * HOUR_MS));
    }, 700);
    return () => clearTimeout(timer);
  }, [playing, offset, store]);

  useEffect(() => {
    if (weatherOn) {
      const patch = weatherTimelinePatch(weatherFilters, temporal.cursor, frames);
      if (filterPatchChanges(weatherFilters, patch)) {
        store.setLayerFilters("weather", { ...weatherFilters, ...patch });
      }
    }

    // Filter writes are outputs of this synchronization. Comparing the patch above keeps the
    // host from feeding its own layer-change event back into another refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temporal.cursor, weatherOn, frames]);

  if (contributions.length === 0) return null;

  const commitDraft = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (Object.is(committedOffsetRef.current, draftRef.current)) return;
    committedOffsetRef.current = draftRef.current;
    store.setTimeCursor(new Date(baseHour.current.getTime() + draftRef.current * HOUR_MS));
  };

  const previewCursor = (hours: number) => {
    draftRef.current = hours;
    setDraftOffset(hours);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(commitDraft, WEATHER_RUNTIME_BUDGET.timelineCommitDelayMs);
  };

  const selected = weatherVisualizationOption(visualization);
  const selectedStats =
    visualization !== "radar" && stats?.variable === visualization ? stats : null;

  const contextLabel = [
    weatherOn ? `Počasí · ${visualization === "radar" ? "Srážkový radar" : selected.label}` : null,
    contributions.some((contribution) => contribution.kind === "dated-plan")
      ? `Plán${activePlan?.departureAt ? ` · odjezd ${formatCursor(activePlan.departureAt)}` : ""}`
      : null,
    eventsOn ? "Události" : null
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <MapTimeline testId="global-timeline" wide>
      {/* One heading for the whole strip (§4.11): what the time cursor currently drives, then
          the cursor itself. Anything more became three competing levels of title. */}
      <div className="timeline-head">
        <span className="timeline-head-label">{contextLabel}</span>
        {cursorOn && (
          <span className="timeline-head-cursor">
            {temporal.mode === "live" ? "Teď" : formatCursor(temporal.cursor)}
            <small>{future ? "Předpověď" : offset < 0 ? "Historie" : "Živá mapa"}</small>
          </span>
        )}
        {cursorOn && (
          <span className="timeline-head-actions">
            <Chip
              label="Živě"
              icon="radar"
              active={temporal.mode === "live"}
              testId="timeline-live"
              onClick={() => {
                if (timerRef.current) clearTimeout(timerRef.current);
                timerRef.current = null;
                setPlaying(false);
                store.setTimeLive();
              }}
            />
            <IconButton
              icon={playing ? "pause" : "play_arrow"}
              label={playing ? "Zastavit přehrávání" : "Přehrát čas"}
              size="sm"
              active={playing}
              testId="timeline-play"
              onClick={() => setPlaying((value) => !value)}
            />
          </span>
        )}
      </div>

      {cursorOn ? (
        <>
          {weatherOn && selectedStats && (
            <div className="viewport-stat" data-testid="weather-viewport-median">
              <span>Medián výřezu</span>
              <strong>
                {formatValue(selectedStats.median)} {selectedStats.unit}
              </strong>
              <small>
                {formatValue(selectedStats.min)}–{formatValue(selectedStats.max)} ·{" "}
                {selectedStats.sampleCount} vzorků
              </small>
            </div>
          )}

          <div className="timeline-controls">
            <input
              type="range"
              min={MIN_HOUR}
              max={MAX_HOUR}
              step={1}
              list="timeline-ticks"
              value={draftOffset}
              onChange={(event) => previewCursor(Number(event.target.value))}
              onPointerUp={commitDraft}
              onKeyUp={commitDraft}
              onBlur={commitDraft}
              className="timeline-scrubber"
              data-testid="timeline-scrubber"
              aria-label="Čas mapy od minulých 24 hodin do sedmi dnů"
            />
            {/* Six-hour ticks with the days named, so a drag lands on "Saturday morning"
                rather than on "+58 h". */}
            <datalist id="timeline-ticks">
              {Array.from(
                { length: Math.floor((MAX_HOUR - MIN_HOUR) / 6) + 1 },
                (_, index) => MIN_HOUR + index * 6
              ).map((hour) => (
                <option key={hour} value={hour} />
              ))}
            </datalist>
            <span className="timeline-days" aria-hidden="true">
              {dayTicks(baseHour.current).map((tick) => (
                <span key={tick.offset} style={{ "--tick": `${tick.percent}%` } as CSSProperties}>
                  {tick.label}
                </span>
              ))}
            </span>
          </div>
        </>
      ) : null}

      {weatherOn && visualization === "radar" ? (
        <div className="weather-source-legend" data-testid="weather-legend">
          <strong>Srážkový radar · intenzita</strong>
          <div className="weather-radar-scale" aria-label="Stupnice intenzity od slabé po silnou">
            <span>slabá</span>
            <span>silná</span>
          </div>
          <span>
            {future
              ? "Radar nemá předpovědní snímek"
              : typeof weatherFilters.frameTs === "number"
                ? formatCursor(new Date(weatherFilters.frameTs * 1000).toISOString())
                : "poslední dostupný snímek"}{" "}
            · RainViewer
          </span>
        </div>
      ) : null}

      {weatherOn && mapDetail?.variable === visualization ? (
        <div
          className="weather-map-detail"
          data-testid="weather-map-detail"
          role="status"
          aria-live="polite"
        >
          <span className="weather-map-detail-kicker">
            {mapDetail.interaction === "tap" ? "Vybrané místo" : "Náhled v mapě"}
          </span>
          <strong>{mapDetail.label}</strong>
          <span>
            {mapDetail.variableLabel} · {formatCursor(mapDetail.validAt)}
          </span>
          <button type="button" onClick={() => setMapDetail(null)} aria-label="Skrýt detail počasí">
            Skrýt
          </button>
        </div>
      ) : null}

      {weatherOn && visualization !== "radar" ? (
        <WeatherLegend option={selected} stats={selectedStats} />
      ) : null}

      {weatherOn && visualization !== "radar" && !selectedStats ? (
        <span className="meta">Načítám {selected.label.toLowerCase()}…</span>
      ) : null}

      {eventsOn ? <EventTimelineContribution /> : null}
    </MapTimeline>
  );
}

/** Compatibility export used by the current shell lazy import. */
export function GlobalTimeline() {
  return <TimelineHost />;
}

function WeatherLegend({
  option,
  stats
}: {
  option: ReturnType<typeof weatherVisualizationOption>;
  stats: GridStats | null;
}) {
  const palette = paletteFor(option.id);
  const [min, max] = palette.domain;
  const span = max - min || 1;
  return (
    <div className="weather-legend" data-testid="weather-legend">
      <div className="weather-legend-ramp" style={{ background: rampCssGradient(palette) }}>
        {palette.ticks.map((tick) => (
          <span
            key={tick}
            className="weather-legend-tick"
            style={{ left: `${((tick - min) / span) * 100}%` }}
          >
            {tick}
          </span>
        ))}
      </div>
      <span className="weather-legend-unit">
        {option.label} · {option.unit}
        {stats
          ? ` · ${representationLabel(stats.representation)} · ${formatCursor(stats.validAt)}`
          : ""}
        {option.vector ? " · proudění pouze v regionálním měřítku" : ""} · Open-Meteo (CC BY 4.0)
      </span>
    </div>
  );
}
