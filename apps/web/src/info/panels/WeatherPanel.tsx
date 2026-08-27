import { EmptyState, Skeleton } from "../../ui/primitives";
import { useInfoData } from "../useInfoData";
import type { InfoPanelProps } from "../registry";

interface Forecast {
  current: { temperature: number; windSpeed: number; windDirection: number; code: number } | null;
  hourly: Array<{ time: string; temperature: number; precipitation: number; code: number }>;
  daily: Array<{ date: string; min: number; max: number; precipitation: number; code: number }>;
}

/** WMO weather codes, grouped to the granularity a glyph can actually convey. */
function weatherIcon(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 57) return "🌦️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "🌨️";
  if (code <= 82) return "🌧️";
  if (code <= 86) return "🌨️";
  return "⛈️";
}

const DAYS = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];

function hour(time: string): string {
  return time.slice(11, 16);
}

export function WeatherPanel({ place }: InfoPanelProps) {
  const state = useInfoData<Forecast>("/info/weather", {
    lng: place.lng.toFixed(4),
    lat: place.lat.toFixed(4)
  });

  if (state.status === "loading") return <Skeleton height={110} />;
  if (state.status !== "ready") {
    return (
      <EmptyState title={state.status === "error" ? state.message : "Předpověď není k dispozici"} />
    );
  }

  const { current, hourly, daily } = state.data;
  return (
    <div className="info-panel" data-testid="panel-pocasi">
      {current && (
        <div className="weather-now">
          <span className="weather-now-icon" aria-hidden>
            {weatherIcon(current.code)}
          </span>
          <strong>{Math.round(current.temperature)} °C</strong>
          <span className="meta">
            vítr {Math.round(current.windSpeed)} km/h
            <span
              className="weather-arrow"
              style={{ transform: `rotate(${current.windDirection}deg)` }}
              aria-hidden
            >
              ↑
            </span>
          </span>
        </div>
      )}

      <div className="weather-hours">
        {hourly
          .filter((_, i) => i % 3 === 0)
          .map((h) => (
            <div key={h.time} className="weather-hour">
              <span className="meta">{hour(h.time)}</span>
              <span aria-hidden>{weatherIcon(h.code)}</span>
              <strong>{Math.round(h.temperature)}°</strong>
            </div>
          ))}
      </div>

      <div className="weather-days">
        {daily.map((d) => (
          <div key={d.date} className="weather-day">
            <span className="meta">{DAYS[new Date(d.date).getDay()]}</span>
            <span aria-hidden>{weatherIcon(d.code)}</span>
            <span>
              <strong>{Math.round(d.max)}°</strong>{" "}
              <span className="meta">{Math.round(d.min)}°</span>
            </span>
            {d.precipitation > 0 && <span className="meta">{d.precipitation.toFixed(1)} mm</span>}
          </div>
        ))}
      </div>

      <p className="meta">Open-Meteo (CC BY 4.0)</p>
    </div>
  );
}
