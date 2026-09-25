import { fetchJson } from "../utils/upstream.js";

/**
 * Long-term monthly temperature normals for a coordinate.
 *
 * Open-Meteo's ERA5 archive is keyless, documented and free for this volume, so the climate
 * block stops being an empty gate and becomes real data. The reference period is fixed at
 * 1991–2020 — the WMO normal period — and stated in the response, because a "monthly average"
 * without a period is not a climate normal, it is a guess.
 *
 * Aggregates are computed per model cell here and cached for a month: the same archive response
 * answers every neighbouring place, and recomputing it for each cafe next door would be both
 * wasteful and inconsistent at the edges of a cell.
 */

export const CLIMATE_PERIOD = "1991-2020" as const;
const ARCHIVE_START = "1991-01-01";
const ARCHIVE_END = "2020-12-31";

export interface MonthlyNormal {
  /** 1 = January. */
  month: number;
  min: number | null;
  max: number | null;
  /** How many daily observations the two figures are built from. */
  samples: number;
}

export interface ClimateNormals {
  status: "ready" | "unavailable";
  period: typeof CLIMATE_PERIOD;
  normals: MonthlyNormal[];
  source: {
    id: "open-meteo-era5";
    label: "Open-Meteo ERA5 archive";
    url: string;
    license: string;
  } | null;
  reason?: string;
}

const UNAVAILABLE: ClimateNormals = {
  status: "unavailable",
  period: CLIMATE_PERIOD,
  normals: [],
  source: null,
  reason: "Historický teplotní přehled se nepodařilo načíst."
};

interface ArchiveResponse {
  daily?: {
    time?: string[];
    temperature_2m_min?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
  };
}

export async function monthlyClimateNormals(
  lng: number,
  lat: number,
  signal?: AbortSignal
): Promise<ClimateNormals> {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&start_date=${ARCHIVE_START}&end_date=${ARCHIVE_END}` +
    `&daily=temperature_2m_min,temperature_2m_max&timezone=auto`;

  let data: ArchiveResponse;
  try {
    data = await fetchJson<ArchiveResponse>(url, {
      providerId: "open-meteo-archive",
      // A full 30-year daily series is a large response; allow it, but only once a month per cell.
      ttlMs: 30 * 24 * 3600_000,
      timeoutMs: 15_000,
      minIntervalMs: 200,
      retries: 1,
      maxResponseBytes: 4_000_000,
      signal
    });
  } catch {
    return UNAVAILABLE;
  }

  const times = data.daily?.time ?? [];
  const mins = data.daily?.temperature_2m_min ?? [];
  const maxs = data.daily?.temperature_2m_max ?? [];
  if (!times.length) return UNAVAILABLE;

  const sumMin = new Array<number>(12).fill(0);
  const sumMax = new Array<number>(12).fill(0);
  const count = new Array<number>(12).fill(0);

  for (let index = 0; index < times.length; index += 1) {
    const month = Number(times[index]!.slice(5, 7));
    if (!Number.isInteger(month) || month < 1 || month > 12) continue;
    const min = mins[index];
    const max = maxs[index];
    if (typeof min !== "number" || !Number.isFinite(min)) continue;
    if (typeof max !== "number" || !Number.isFinite(max)) continue;
    sumMin[month - 1] += min;
    sumMax[month - 1] += max;
    count[month - 1] += 1;
  }

  if (!count.some((value) => value > 0)) return UNAVAILABLE;

  const normals: MonthlyNormal[] = Array.from({ length: 12 }, (_, monthIndex) => ({
    month: monthIndex + 1,
    min: count[monthIndex] ? round(sumMin[monthIndex]! / count[monthIndex]!) : null,
    max: count[monthIndex] ? round(sumMax[monthIndex]! / count[monthIndex]!) : null,
    samples: count[monthIndex]!
  }));

  return {
    status: "ready",
    period: CLIMATE_PERIOD,
    normals,
    source: {
      id: "open-meteo-era5",
      label: "Open-Meteo ERA5 archive",
      url: "https://open-meteo.com/en/docs/historical-weather-api",
      license: "CC BY 4.0"
    }
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
