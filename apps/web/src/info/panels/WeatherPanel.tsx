import { EmptyState, Skeleton } from "../../ui/primitives";
import { DailyForecastDetails, forecastWeatherIcon } from "../../ui/weather/DailyForecastDetails";
import type { ForecastDay, ForecastHour } from "../../ui/weather/forecastDetails";
import { useInfoData } from "../useInfoData";
import type { InfoPanelProps } from "../registry";

interface Forecast {
  current: {
    temperature: number | null;
    windSpeed: number | null;
    windDirection: number | null;
    code: number | null;
  } | null;
  hourly: ForecastHour[];
  daily: ForecastDay[];
  source: { id: string; label: string; url: string | null; license: string };
  climate: {
    status: "unavailable";
    normals: [];
    extremes: [];
    source: null;
    gate: string;
    reason: string;
  };
}

function degrees(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}°`;
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

  const { current, hourly, daily, source, climate } = state.data;
  return (
    <div className="info-panel" data-testid="panel-pocasi">
      {current && (
        <div className="weather-now">
          <span className="weather-now-icon" aria-hidden>
            {forecastWeatherIcon(current.code)}
          </span>
          <strong>{degrees(current.temperature)}</strong>
          <span className="meta">
            vítr {current.windSpeed === null ? "—" : `${Math.round(current.windSpeed)} km/h`}
            {current.windDirection !== null ? (
              <span
                className="weather-arrow"
                style={{ transform: `rotate(${current.windDirection}deg)` }}
                aria-hidden
              >
                ↑
              </span>
            ) : null}
          </span>
        </div>
      )}

      <section className="weather-forecast-block" aria-labelledby="weather-seven-day-title">
        <h4 id="weather-seven-day-title">Předpověď na 7 dní</h4>
        <DailyForecastDetails daily={daily} hourly={hourly} />

        <p className="meta weather-source">
          Zdroj:{" "}
          {source.url ? (
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.label}
            </a>
          ) : (
            source.label
          )}{" "}
          · {source.license}
        </p>
      </section>

      <section className="weather-climate-block" aria-labelledby="weather-climate-title">
        <h4 id="weather-climate-title">Klimatické statistiky a historické extrémy</h4>
        <p className="meta">{climate.reason}</p>
        <p className="meta">Zdroj není připojen; z 7denní předpovědi tyto údaje neodvozujeme.</p>
      </section>
    </div>
  );
}
