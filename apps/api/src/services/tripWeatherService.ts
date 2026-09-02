import type { TripStop, TripWeatherSample } from "@mapos/layer-sdk";
import { fetchJson } from "../utils/upstream.js";

interface HourlyPayload {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    precipitation?: number[];
    weather_code?: number[];
  };
}

function nearestHour(payload: HourlyPayload, at: string) {
  const target = new Date(at).getTime();
  const times = payload.hourly?.time ?? [];
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < times.length; index += 1) {
    const value = new Date(`${times[index]}Z`).getTime();
    const distance = Math.abs(value - target);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  if (bestIndex < 0 || bestDistance > 4 * 3600_000) return null;
  return {
    temperature: payload.hourly?.temperature_2m?.[bestIndex] ?? null,
    precipitation: payload.hourly?.precipitation?.[bestIndex] ?? null,
    weatherCode: payload.hourly?.weather_code?.[bestIndex] ?? null
  };
}

export async function weatherForTripStops(
  stops: TripStop[],
  arrivalTimes: string[],
  timeoutMs = 4_500
): Promise<TripWeatherSample[]> {
  if (!stops.length) return [];
  const results: TripWeatherSample[] = [];
  for (let offset = 0; offset < stops.length; offset += 20) {
    const batch = stops.slice(offset, offset + 20);
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", batch.map((stop) => stop.lat.toFixed(4)).join(","));
    url.searchParams.set("longitude", batch.map((stop) => stop.lng.toFixed(4)).join(","));
    url.searchParams.set("hourly", "temperature_2m,precipitation,weather_code");
    url.searchParams.set("forecast_days", "8");
    url.searchParams.set("past_days", "1");
    url.searchParams.set("timezone", "UTC");
    try {
      const raw = await fetchJson<HourlyPayload | HourlyPayload[]>(url.href, {
        providerId: "weather-open-meteo-trip",
        ttlMs: 10 * 60_000,
        timeoutMs,
        retries: 1,
        maxResponseBytes: 4 * 1024 * 1024
      });
      const payloads = Array.isArray(raw) ? raw : [raw];
      for (let index = 0; index < batch.length; index += 1) {
        const stop = batch[index]!;
        const at = arrivalTimes[offset + index] ?? arrivalTimes.at(-1) ?? new Date().toISOString();
        const weather = nearestHour(payloads[index] ?? {}, at);
        results.push({
          stopId: stop.id,
          at,
          temperature: weather?.temperature ?? null,
          precipitation: weather?.precipitation ?? null,
          weatherCode: weather?.weatherCode ?? null
        });
      }
    } catch {
      for (let index = 0; index < batch.length; index += 1) {
        results.push({
          stopId: batch[index]!.id,
          at: arrivalTimes[offset + index] ?? new Date().toISOString(),
          temperature: null,
          precipitation: null,
          weatherCode: null
        });
      }
    }
  }
  return results;
}
