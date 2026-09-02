import {
  detailedHoursForDay,
  forecastDayLabel,
  forecastHourLabel,
  type ForecastDay,
  type ForecastHour
} from "./forecastDetails";

function degrees(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}°`;
}

function precipitation(value: number | null): string {
  return value === null ? "bez údaje" : `${value.toFixed(1)} mm`;
}

/** WMO weather codes, grouped to the granularity a small glyph can convey. */
export function forecastWeatherIcon(code: number | null): string {
  if (code === null) return "—";
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

export function DailyForecastDetails({
  daily,
  hourly,
  compact = false,
  className = ""
}: {
  daily: ForecastDay[];
  hourly: ForecastHour[];
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`daily-forecast-list${compact ? " is-compact" : ""}${className ? ` ${className}` : ""}`}
      aria-label="Předpověď po jednotlivých dnech"
    >
      {daily.map((day) => {
        const detailedHours = detailedHoursForDay(hourly, day.date);
        const label = forecastDayLabel(day.date);
        return (
          <details className="daily-forecast-day" data-testid="forecast-day" key={day.date}>
            <summary aria-label={`Detail předpovědi: ${label}`}>
              <span className="daily-forecast-date">{label}</span>
              <span className="daily-forecast-icon" aria-hidden="true">
                {forecastWeatherIcon(day.code)}
              </span>
              <span className="daily-forecast-temperatures">
                <strong>{degrees(day.max)}</strong>
                <small>{degrees(day.min)}</small>
              </span>
              <span className="daily-forecast-rain">
                {day.precipitation !== null && day.precipitation > 0
                  ? precipitation(day.precipitation)
                  : "beze srážek"}
              </span>
            </summary>
            <div className="daily-forecast-detail">
              <div className="daily-forecast-detail-heading">
                <strong>Průběh dne</strong>
                <small>teplota · srážky</small>
              </div>
              {detailedHours.length ? (
                <div className="daily-forecast-hours" aria-label={`Hodinová předpověď: ${label}`}>
                  {detailedHours.map((hour) => (
                    <div className="daily-forecast-hour" key={hour.time}>
                      <small>{forecastHourLabel(hour.time)}</small>
                      <span aria-hidden="true">{forecastWeatherIcon(hour.code)}</span>
                      <strong>{degrees(hour.temperature)}</strong>
                      <small>{precipitation(hour.precipitation)}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="meta daily-forecast-empty">
                  Pro tento den zdroj neposkytl hodinové rozlišení.
                </p>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
