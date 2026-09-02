import type {
  DataProvider,
  PlanDocumentV2,
  PlanTemporalContextV2,
  TripStop,
  TripWeatherSample
} from "@mapos/layer-sdk";
import { selectedPlanAlternative } from "./planTemporalSelection.js";
import { weatherForTripStops } from "./tripWeatherService.js";

const HOUR_MS = 3_600_000;
export const PLAN_WEATHER_STOP_BUDGET = 20;

export type PlanWeatherSampler = (
  stops: TripStop[],
  arrivalTimes: string[]
) => Promise<TripWeatherSample[]>;

function sampledIndexes(total: number): number[] {
  if (total <= PLAN_WEATHER_STOP_BUDGET) return Array.from({ length: total }, (_, index) => index);
  return [
    ...new Set(
      Array.from({ length: PLAN_WEATHER_STOP_BUDGET }, (_, index) =>
        Math.round((index * (total - 1)) / (PLAN_WEATHER_STOP_BUDGET - 1))
      )
    )
  ];
}

function warningFor(sample: TripWeatherSample, stopName: string): string[] {
  const warnings: string[] = [];
  if (sample.precipitation !== null && sample.precipitation >= 0.2) {
    warnings.push(`Déšť u ${stopName}: ${sample.precipitation.toFixed(1)} mm v hodině příjezdu.`);
  }
  if (sample.temperature !== null && sample.temperature <= 0) {
    warnings.push(`Mráz u ${stopName}: ${sample.temperature.toFixed(1)} °C v hodině příjezdu.`);
  } else if (sample.temperature !== null && sample.temperature >= 32) {
    warnings.push(`Horko u ${stopName}: ${sample.temperature.toFixed(1)} °C v hodině příjezdu.`);
  }
  return warnings;
}

export async function buildPlanTemporalContext(
  plan: PlanDocumentV2,
  provider: DataProvider,
  weatherSampler: PlanWeatherSampler = weatherForTripStops,
  now = new Date()
): Promise<PlanTemporalContextV2> {
  const generatedAt = now.toISOString();
  const departureMs = plan.departureAt ? Date.parse(plan.departureAt) : Number.NaN;
  if (!Number.isFinite(departureMs)) {
    return {
      status: "inactive",
      planId: plan.id,
      departureAt: null,
      generatedAt,
      temporalControls: { cursor: null, minimum: null, maximum: null },
      weather: {
        status: "disabled",
        sampledStops: 0,
        totalStops: plan.stops.length,
        source: null,
        reason: "Plán nemá platný čas odjezdu."
      },
      traffic: {
        status: "disabled",
        source: null,
        reason: "Plán nemá platný čas odjezdu."
      },
      stops: [],
      segments: [],
      dataBudget: {
        maxWeatherStops: PLAN_WEATHER_STOP_BUDGET,
        sampledStops: 0,
        upstreamWeatherRequests: 0
      }
    };
  }

  const departureAt = new Date(departureMs).toISOString();
  const stopArrivalTimes: Array<string | null> = [departureAt];
  let nextSegmentDeparture: string | null = departureAt;
  const segmentTimes = plan.segments.map((segment) => {
    const segmentDeparture = nextSegmentDeparture;
    const alternative = selectedPlanAlternative(segment);
    const arrivalAt =
      segmentDeparture && alternative
        ? new Date(Date.parse(segmentDeparture) + alternative.durationS * 1_000).toISOString()
        : null;
    stopArrivalTimes[segment.order + 1] = arrivalAt;
    const dwellMinutes = plan.stops[segment.order + 1]?.dwellMinutes ?? 0;
    nextSegmentDeparture = arrivalAt
      ? new Date(Date.parse(arrivalAt) + dwellMinutes * 60_000).toISOString()
      : null;
    return { segment, departureAt: segmentDeparture, arrivalAt };
  });

  const weatherEnabled = plan.routePolicy.weatherAlongRoute !== false;
  const forecastMinimum = new Date(now.getTime() - 24 * HOUR_MS).toISOString();
  const forecastMaximum = new Date(now.getTime() + 8 * 24 * HOUR_MS).toISOString();
  const inForecastRange =
    departureMs >= Date.parse(forecastMinimum) && departureMs <= Date.parse(forecastMaximum);
  const indexes = weatherEnabled && inForecastRange ? sampledIndexes(plan.stops.length) : [];
  const sampledStops = indexes.map((index): TripStop => {
    const stop = plan.stops[index]!;
    return {
      id: stop.id,
      name: stop.name,
      lng: stop.location.coordinates[0],
      lat: stop.location.coordinates[1],
      dwellMinutes: stop.dwellMinutes
    };
  });
  const sampledArrivalTimes = indexes.map(
    (index) => stopArrivalTimes[index] ?? departureAt
  ) as string[];
  const rawWeather = indexes.length ? await weatherSampler(sampledStops, sampledArrivalTimes) : [];
  const stops = rawWeather.map((sample) => ({
    stopId: sample.stopId,
    at: sample.at,
    temperatureC: sample.temperature,
    precipitationMm: sample.precipitation,
    weatherCode: sample.weatherCode
  }));
  const usefulWeather = rawWeather.filter(
    (sample) =>
      sample.temperature !== null || sample.precipitation !== null || sample.weatherCode !== null
  );
  const trafficEnabled = plan.routePolicy.trafficAlongRoute !== false;
  const nearLiveDeparture = Math.abs(departureMs - now.getTime()) <= 30 * 60_000;
  const providerTrafficAware =
    trafficEnabled &&
    provider === "mapy" &&
    nearLiveDeparture &&
    plan.segments.some((segment) => selectedPlanAlternative(segment)?.profile.includes("traffic"));
  const trafficStatus = !trafficEnabled
    ? "disabled"
    : providerTrafficAware
      ? "provider-aware"
      : "unavailable";
  const rawWeatherByStop = new Map(rawWeather.map((sample) => [sample.stopId, sample]));

  return {
    status: "active",
    planId: plan.id,
    departureAt,
    generatedAt,
    temporalControls: {
      cursor: departureAt,
      minimum: forecastMinimum,
      maximum: forecastMaximum
    },
    weather: {
      status: !weatherEnabled
        ? "disabled"
        : !inForecastRange
          ? "out-of-range"
          : usefulWeather.length
            ? "ready"
            : "unavailable",
      sampledStops: usefulWeather.length,
      totalStops: plan.stops.length,
      source: usefulWeather.length
        ? {
            id: "open-meteo-forecast",
            label: "Open-Meteo Forecast API",
            url: "https://open-meteo.com/"
          }
        : null,
      reason: !weatherEnabled
        ? "Počasí podél trasy je vypnuté."
        : !inForecastRange
          ? "Čas odjezdu leží mimo dostupné předpovědní okno."
          : usefulWeather.length
            ? null
            : "Poskytovatel pro tento čas nevrátil použitelnou předpověď; nic se nesimuluje."
    },
    traffic: {
      status: trafficStatus,
      source: providerTrafficAware
        ? { id: "mapy-live-routing", label: "Mapy.com live traffic routing" }
        : null,
      reason:
        trafficStatus === "disabled"
          ? "Dopravní kontext podél trasy je vypnutý."
          : trafficStatus === "provider-aware"
            ? null
            : "Provider neposkytl ověřitelná dopravní data pro plánovaný čas; nic se nesimuluje."
    },
    stops,
    segments: segmentTimes.map(({ segment, departureAt: segmentDeparture, arrivalAt }) => {
      const destination = plan.stops[segment.order + 1];
      const weather = destination ? rawWeatherByStop.get(destination.id) : undefined;
      return {
        segmentId: segment.id,
        order: segment.order,
        departureAt: segmentDeparture,
        arrivalAt,
        weatherAtArrival: weather
          ? {
              stopId: weather.stopId,
              at: weather.at,
              temperatureC: weather.temperature,
              precipitationMm: weather.precipitation,
              weatherCode: weather.weatherCode
            }
          : null,
        trafficStatus,
        warnings: weather && destination ? warningFor(weather, destination.name) : []
      };
    }),
    dataBudget: {
      maxWeatherStops: PLAN_WEATHER_STOP_BUDGET,
      sampledStops: indexes.length,
      upstreamWeatherRequests: indexes.length ? 1 : 0
    }
  };
}
