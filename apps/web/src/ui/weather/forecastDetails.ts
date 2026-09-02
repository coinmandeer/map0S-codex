export interface ForecastHour {
  time: string;
  temperature: number | null;
  precipitation: number | null;
  code: number | null;
}

export interface ForecastDay {
  date: string;
  min: number | null;
  max: number | null;
  precipitation: number | null;
  code: number | null;
}

export function detailedHoursForDay(
  hourly: ForecastHour[],
  date: string,
  step = 3
): ForecastHour[] {
  const safeStep = Math.max(1, Math.floor(step));
  return hourly
    .filter((hour) => hour.time.slice(0, 10) === date)
    .filter((_, i) => i % safeStep === 0);
}

export function forecastDayLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("cs-CZ", {
    weekday: "short",
    day: "numeric",
    month: "numeric"
  }).format(parsed);
}

export function forecastHourLabel(time: string): string {
  const match = /T(\d{2}:\d{2})/u.exec(time);
  return match?.[1] ?? time;
}
