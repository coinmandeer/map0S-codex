import SunCalc from "suncalc";
import { skyBrightnessAt, skyAtlasSource, type SkyBrightness } from "./skyAtlasService.js";
import { fetchJson } from "../utils/upstream.js";
export interface NightSkyConditions {
  sources?: { sourceId: string; label: string; url: string; retrievedAt: string }[];
  at: string;
  timezone: string;
  localTime: string;
  nightStart: string | null;
  nightEnd: string | null;
  moonAltitudeDeg: number;
  moonIlluminatedFraction: number;
  cloudCoverPercent: number | null;
  skyBrightness: SkyBrightness | null;
  limitations: string[];
}
const iso = (date: Date) => (Number.isFinite(date.getTime()) ? date.toISOString() : null);
/** Astronomical instants are calculated locally; display always names the observing timezone. */
export function astronomyAt(
  lng: number,
  lat: number,
  at: Date,
  timezone: string
): Omit<NightSkyConditions, "cloudCoverPercent" | "skyBrightness" | "limitations"> {
  if (
    !Number.isFinite(at.getTime()) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    Math.abs(lng) > 180 ||
    Math.abs(lat) > 90
  )
    throw new Error("Invalid observing location or time");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(at);
  const part = (name: string) => Number(parts.find((p) => p.type === name)!.value);
  const noon = new Date(
    Date.UTC(part("year"), part("month") - 1, part("day"), 12) - (lng / 15) * 3600000
  );
  const today = SunCalc.getTimes(noon, lat, lng),
    tomorrow = SunCalc.getTimes(new Date(noon.getTime() + 86400000), lat, lng);
  const beforeDawn =
    Number.isFinite(today.nightEnd.getTime()) && at.getTime() < today.nightEnd.getTime();
  const previous = beforeDawn
    ? SunCalc.getTimes(new Date(noon.getTime() - 86400000), lat, lng)
    : null;
  const moon = SunCalc.getMoonPosition(at, lat, lng),
    illumination = SunCalc.getMoonIllumination(at);
  return {
    at: at.toISOString(),
    timezone,
    localTime: new Intl.DateTimeFormat("cs-CZ", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short"
    }).format(at),
    nightStart: iso(previous?.night ?? today.night),
    nightEnd: iso(beforeDawn ? today.nightEnd : tomorrow.nightEnd),
    moonAltitudeDeg: (moon.altitude * 180) / Math.PI,
    moonIlluminatedFraction: illumination.fraction
  };
}
export async function nightSkyConditions(
  lng: number,
  lat: number,
  at: string,
  signal?: AbortSignal
): Promise<NightSkyConditions> {
  const requested = new Date(at);
  if (
    !Number.isFinite(requested.getTime()) ||
    Math.abs(requested.getTime() - Date.now()) > 7 * 86400000
  )
    throw new Error("Podmínky lze získat nejvýše na sedm dní");
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: "cloud_cover",
    forecast_days: "7",
    timezone: "auto",
    timeformat: "unixtime"
  });
  const weather = await fetchJson<{
    timezone?: string;
    hourly?: { time?: number[]; cloud_cover?: (number | null)[] };
  }>(`https://api.open-meteo.com/v1/forecast?${params}`, {
    providerId: "open-meteo",
    signal,
    ttlMs: 30 * 60000,
    maxResponseBytes: 256 * 1024
  });
  if (!weather.timezone) throw new Error("Časové pásmo místa se nepodařilo ověřit");
  const times = weather.hourly?.time ?? [];
  let best = -1;
  times.forEach((time, i) => {
    if (
      best < 0 ||
      Math.abs(time * 1000 - requested.getTime()) <
        Math.abs(times[best]! * 1000 - requested.getTime())
    )
      best = i;
  });
  const cloud =
    best >= 0 && Math.abs(times[best]! * 1000 - requested.getTime()) <= 3600000
      ? weather.hourly?.cloud_cover?.[best]
      : null;
  let brightness: SkyBrightness | null = null;
  try {
    brightness = await skyBrightnessAt(lng, lat, signal);
  } catch {
    signal?.throwIfAborted();
  }
  return {
    ...astronomyAt(lng, lat, requested, weather.timezone),
    sources: [
      ...(brightness ? [{ ...skyAtlasSource, retrievedAt: new Date().toISOString() }] : []),
      {
        sourceId: "astronomy-suncalc",
        label: "SunCalc 1.9 — místní astronomický výpočet",
        url: "https://github.com/mourner/suncalc/tree/v1.9.0",
        retrievedAt: new Date().toISOString()
      },
      {
        sourceId: "open-meteo",
        label: "Open-Meteo — předpověď oblačnosti",
        url: "https://open-meteo.com",
        retrievedAt: new Date().toISOString()
      }
    ],
    cloudCoverPercent: typeof cloud === "number" && cloud >= 0 && cloud <= 100 ? cloud : null,
    skyBrightness: brightness,
    limitations: [
      ...(brightness
        ? ["Model 2015 udává pouze umělou složku zenitového jasu, bez přirozeného pozadí."]
        : ["Numerický model jasu oblohy není pro toto místo načtený."]),
      "Historická noční světla nejsou měřením aktuálního jasu oblohy.",
      ...(cloud == null ? ["Pro zvolený čas není dostupná hodinová předpověď oblačnosti."] : [])
    ]
  };
}
