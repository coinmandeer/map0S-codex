import { t } from "../../i18n";
import { useSectionEmpty } from "../SectionAvailability";
import { EmptyState, Skeleton } from "../../ui/primitives";
import { DailyForecastDetails, forecastWeatherIcon } from "../../ui/weather/DailyForecastDetails";
import type { ForecastDay, ForecastHour } from "../../ui/weather/forecastDetails";
import { useInfoData } from "../useInfoData";
import type { InfoPanelProps } from "../registry";

interface MonthlyNormal {
  month: number;
  min: number | null;
  max: number | null;
  samples: number;
}

interface Climate {
  status: "ready" | "unavailable";
  period: string;
  normals: MonthlyNormal[];
  source: { id: string; label: string; url: string | null; license: string } | null;
  reason?: string;
}

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
  climate: Climate;
}

function degrees(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}°`;
}

const MONTHS_CS = [
  "Led",
  "Úno",
  "Bře",
  "Dub",
  "Kvě",
  "Čvn",
  "Čvc",
  "Srp",
  "Zář",
  "Říj",
  "Lis",
  "Pro"
];

/** A 12-month min/max band, labelled as a long-term climate overview rather than a forecast.
 *  Drawn as two thin lines over one shared scale so a reader can see the shape of the year
 *  without reading twelve pairs of numbers. */
function ClimateChart({ climate }: { climate: Climate }) {
  const withData = climate.normals.filter((entry) => entry.min !== null && entry.max !== null);
  if (!withData.length) return null;
  const all = withData.flatMap((entry) => [entry.min!, entry.max!]);
  const low = Math.min(...all);
  const high = Math.max(...all);
  const span = Math.max(1, high - low);
  const y = (value: number) => 100 - ((value - low) / span) * 100;

  return (
    <section className="weather-climate-block" data-testid="weather-climate">
      <h4>{t("polish.climate")}</h4>
      <p className="meta">
        {t("polish.climatePeriod")}: {climate.period}
      </p>
      <div className="weather-climate-chart" role="img" aria-label={t("polish.climate")}>
        {climate.normals.map((entry) => {
          if (entry.min === null || entry.max === null) {
            return <span key={entry.month} className="weather-climate-col" aria-hidden />;
          }
          return (
            <span
              key={entry.month}
              className="weather-climate-col"
              title={`${MONTHS_CS[entry.month - 1]}: ${entry.min}° / ${entry.max}°`}
            >
              <span
                className="weather-climate-band"
                style={{
                  bottom: `${y(entry.min)}%`,
                  height: `${Math.max(2, y(entry.min) - y(entry.max))}%`
                }}
              />
              <span className="weather-climate-month">{MONTHS_CS[entry.month - 1]}</span>
            </span>
          );
        })}
      </div>
      {climate.source && (
        <p className="meta weather-source">
          {t("polish.sources")}:{" "}
          {climate.source.url ? (
            <a href={climate.source.url} target="_blank" rel="noreferrer">
              {climate.source.label}
            </a>
          ) : (
            climate.source.label
          )}{" "}
          · {climate.source.license}
        </p>
      )}
    </section>
  );
}

export function WeatherPanel({ place }: InfoPanelProps) {
  const state = useInfoData<Forecast>("/info/weather", {
    lng: place.lng.toFixed(4),
    lat: place.lat.toFixed(4)
  });

  useSectionEmpty(
    state.status === "empty" ||
      (state.status === "ready" && !state.data.current && !state.data.daily.length)
  );
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
            {t("polish.wind")}{" "}
            {current.windSpeed === null ? "—" : `${Math.round(current.windSpeed)} km/h`}
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
        <h4 id="weather-seven-day-title">{t("polish.forecast")}</h4>
        <DailyForecastDetails daily={daily} hourly={hourly} />

        <p className="meta weather-source">
          {t("polish.sources")}:{" "}
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

      {climate.status === "ready" && <ClimateChart climate={climate} />}
    </div>
  );
}
