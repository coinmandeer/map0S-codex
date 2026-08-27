import { useEffect, useMemo, useRef, useState } from "react";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { API_BASE } from "../lib/api";
import { paletteFor, rampCssGradient } from "../layers/weather/palettes";
import { MapTimeline } from "./MapTimeline";
import type { WeatherVariableId } from "../layers/weather/grid";

interface WeatherVariableOption {
  id: WeatherVariableId;
  label: string;
  unit: string;
  vector: boolean;
}

/** Mirrors the server registry so the pills render before `/weather/variables` answers — and
 *  still work if it never does. */
const FALLBACK_VARIABLES: WeatherVariableOption[] = [
  { id: "wind", label: "Vítr", unit: "m/s", vector: true },
  { id: "temperature", label: "Teplota", unit: "°C", vector: false },
  { id: "precipitation", label: "Srážky", unit: "mm", vector: false },
  { id: "clouds", label: "Oblačnost", unit: "%", vector: false },
  { id: "gusts", label: "Nárazy", unit: "m/s", vector: false },
  { id: "pressure", label: "Tlak", unit: "hPa", vector: false },
  { id: "humidity", label: "Vlhkost", unit: "%", vector: false }
];

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

export function WeatherTimeline() {
  const store = getMapStore();
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  const [frames, setFrames] = useState<number[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [variables, setVariables] = useState<WeatherVariableOption[]>(FALLBACK_VARIABLES);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/weather/frames`)
      .then((r) => (r.ok ? r.json() : { frames: [] }))
      .then((data: { frames?: number[] }) => {
        if (!cancelled) setFrames(data.frames ?? []);
      })
      .catch(() => {
        if (!cancelled) setFrames([]);
      });

    fetch(`${API_BASE}/weather/variables`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { variables?: WeatherVariableOption[] } | null) => {
        if (!cancelled && data?.variables?.length) setVariables(data.variables);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const frameTs = index != null ? frames[index] : undefined;
    const current = active.weather?.filters ?? {};
    store.setLayerFilters("weather", { ...current, frameTs: frameTs ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, frames]);

  useEffect(() => {
    if (!playing || frames.length < 2) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      return;
    }
    timerRef.current = window.setInterval(() => {
      setIndex((prev) => {
        const next = prev == null ? 0 : prev + 1;
        return next >= frames.length ? 0 : next;
      });
    }, 700);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [playing, frames.length]);

  const filters = active.weather?.filters ?? {};
  const variable = (filters.variable as WeatherVariableId | null | undefined) ?? null;
  const radarOn = filters.radar !== false;
  const selected = useMemo(
    () => variables.find((v) => v.id === variable) ?? null,
    [variables, variable]
  );

  if (!active.weather?.visible) return null;

  const patchFilters = (patch: Record<string, unknown>) => {
    store.setLayerFilters("weather", { ...(active.weather?.filters ?? {}), ...patch });
  };

  return (
    <MapTimeline testId="weather-timeline">
      {frames.length > 1 ? (
        <div className="timeline-controls">
          <button
            className="icon-btn small"
            onClick={() => setPlaying((p) => !p)}
            data-testid="timeline-play"
            aria-label={playing ? "Pauza" : "Přehrát"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            step={1}
            value={index ?? frames.length - 1}
            onChange={(e) => {
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
            className="timeline-scrubber"
            data-testid="timeline-scrubber"
          />
          <span className="timeline-time">{formatTime(frames[index ?? frames.length - 1]!)}</span>
        </div>
      ) : (
        <span className="meta">Živý radar · archiv 24h se právě plní</span>
      )}

      <div className="owm-pills" data-testid="weather-variables">
        <button
          className={`owm-pill ${radarOn ? "active" : ""}`}
          onClick={() => patchFilters({ radar: !radarOn })}
          data-testid="weather-radar-toggle"
          aria-pressed={radarOn}
        >
          Radar
        </button>
        <span className="owm-pill-divider" aria-hidden="true" />
        {variables.map((option) => (
          <button
            key={option.id}
            className={`owm-pill ${variable === option.id ? "active" : ""}`}
            onClick={() => patchFilters({ variable: variable === option.id ? null : option.id })}
            data-testid={`weather-var-${option.id}`}
            aria-pressed={variable === option.id}
          >
            {option.label}
          </button>
        ))}
      </div>

      {selected ? <WeatherLegend variable={selected} /> : null}
    </MapTimeline>
  );
}

function WeatherLegend({ variable }: { variable: WeatherVariableOption }) {
  const palette = paletteFor(variable.id);
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
        {variable.label} · {variable.unit}
        {variable.vector ? " · animovaný tok" : ""}
      </span>
    </div>
  );
}
