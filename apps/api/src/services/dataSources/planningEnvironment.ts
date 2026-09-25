import type { GeoFeature } from "@mapos/layer-sdk";
import { fetchJson } from "../../utils/upstream.js";
import { bboxCenter, point, type DataSource } from "./types.js";

export interface MarineResponse {
  latitude: number;
  longitude: number;
  current?: {
    time?: number;
    wave_height?: number | null;
    wave_period?: number | null;
    sea_surface_temperature?: number | null;
  };
  current_units?: Record<string, string>;
}
export function marineFeature(data: MarineResponse, now = Date.now()): GeoFeature[] {
  const c = data.current;
  if (
    !c ||
    !Number.isFinite(data.latitude) ||
    Math.abs(data.latitude) > 90 ||
    !Number.isFinite(data.longitude) ||
    Math.abs(data.longitude) > 180 ||
    !Number.isFinite(c.time) ||
    now - c.time! * 1000 > 6 * 3600000 ||
    c.time! * 1000 > now + 3600000
  )
    throw new Error("Neplatný nebo zastaralý mořský model");
  const number = (value: unknown, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
      ? value
      : null;
  const wave = data.current_units?.wave_height === "m" ? number(c.wave_height, 0, 40) : null;
  const period = data.current_units?.wave_period === "s" ? number(c.wave_period, 0, 100) : null;
  const temperature =
    data.current_units?.sea_surface_temperature === "°C"
      ? number(c.sea_surface_temperature, -5, 50)
      : null;
  if (wave === null && period === null && temperature === null) return [];
  const time = new Date(c.time! * 1000).toISOString();
  return [
    point(
      `marine:${data.longitude}:${data.latitude}`,
      `Moře · vlny ${wave === null ? "bez dat" : `${wave} m`} · voda ${temperature === null ? "bez dat" : `${temperature} °C`}`,
      data.longitude,
      data.latitude,
      "marine-conditions",
      {
        waveHeight: wave,
        wavePeriod: period,
        waterTemperature: temperature,
        validAt: time,
        sourceId: "open-meteo-marine",
        source: "Open-Meteo · modely mořských podmínek",
        website: "https://open-meteo.com/en/docs/marine-weather-api",
        description: `Modelová buňka pro střed výřezu, ${time}. Perioda vln: ${period === null ? "bez dat" : `${period} s`}. Rozlišení závisí na modelu; nejde o měření na konkrétní pláži ani podklad pro pobřežní navigaci.`
      }
    )
  ];
}
export interface PowerResponse {
  geometry?: { type?: string; coordinates?: number[] };
  properties?: { parameter?: Record<string, Record<string, number>> };
  parameters?: Record<string, { units?: string }>;
  header?: { range?: string; fill_value?: number; sources?: string[] };
}
export function powerFeature(data: PowerResponse): GeoFeature[] {
  const coordinates = data.geometry?.coordinates,
    period = data.header?.range;
  if (
    data.geometry?.type !== "Point" ||
    !coordinates ||
    !Number.isFinite(coordinates[0]) ||
    Math.abs(coordinates[0]!) > 180 ||
    !Number.isFinite(coordinates[1]) ||
    Math.abs(coordinates[1]!) > 90 ||
    typeof period !== "string" ||
    !period ||
    period.length > 500
  )
    throw new Error("NASA POWER: chybí poloha nebo klimatické období");
  const read = (key: string, unit: string) => {
    const value = data.properties?.parameter?.[key]?.ANN;
    return data.parameters?.[key]?.units === unit &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      value !== (data.header?.fill_value ?? -999)
      ? value
      : null;
  };
  const solar = read("ALLSKY_SFC_SW_DWN", "kW-hr/m^2/day"),
    temperature = read("T2M", "C"),
    rain = read("PRECTOTCORR", "mm/day");
  if (solar === null && temperature === null && rain === null) return [];
  return [
    point(
      `nasa-power:${coordinates[0]}:${coordinates[1]}`,
      `Sluneční energie · ${solar === null ? "bez dat" : `${solar.toFixed(2)} kWh/m²/den`}`,
      coordinates[0]!,
      coordinates[1]!,
      "solar-climate",
      {
        solarEnergy: solar,
        temperature,
        precipitation: rain,
        period,
        sourceId: "nasa-power",
        source: `NASA POWER · ${(data.header?.sources ?? []).join(" / ")}`,
        website: "https://power.larc.nasa.gov/docs/services/api/temporal/climatology/",
        description: `${period}. Průměrná denní energie pro celý rok, nikoli aktuální záření. Roční průměr teploty ${temperature === null ? "bez dat" : `${temperature} °C`}; srážky ${rain === null ? "bez dat" : `${rain} mm/den`}. Hrubý regionální model; bod označuje místo dotazu, ne měřicí stanici.`
      }
    )
  ];
}
const localOnly: DataSource["tooLarge"] = (b) =>
  (b[2] - b[0]) * (b[3] - b[1]) > 25
    ? "Přibližte mapu: tato vrstva zobrazuje jeden datový vzorek pro střed výřezu."
    : null;
export const planningEnvironmentSources: DataSource[] = [
  {
    id: "marine-conditions",
    tooLarge: localOnly,
    async load(bbox, _query, signal) {
      const { lng, lat } = bboxCenter(bbox);
      const params = new URLSearchParams({
        latitude: lat.toFixed(2),
        longitude: lng.toFixed(2),
        current: "wave_height,wave_period,sea_surface_temperature",
        timezone: "GMT",
        timeformat: "unixtime"
      });
      const data = await fetchJson<MarineResponse>(
        `https://marine-api.open-meteo.com/v1/marine?${params}`,
        {
          providerId: "open-meteo-marine",
          ttlMs: 30 * 60000,
          minIntervalMs: 1500,
          retries: 0,
          maxResponseBytes: 64000,
          signal
        }
      );
      return marineFeature(data);
    }
  },
  {
    id: "solar-climate",
    tooLarge: localOnly,
    async load(bbox, _query, signal) {
      const { lng, lat } = bboxCenter(bbox);
      const params = new URLSearchParams({
        latitude: lat.toFixed(2),
        longitude: lng.toFixed(2),
        parameters: "ALLSKY_SFC_SW_DWN,T2M,PRECTOTCORR",
        community: "RE",
        format: "JSON"
      });
      const data = await fetchJson<PowerResponse>(
        `https://power.larc.nasa.gov/api/temporal/climatology/point?${params}`,
        {
          providerId: "nasa-power",
          ttlMs: 24 * 3600000,
          minIntervalMs: 1500,
          retries: 0,
          maxResponseBytes: 256000,
          signal
        }
      );
      return powerFeature(data);
    }
  }
];
