import { fetchJson } from "../utils/upstream.js";

/**
 * Population for an area, from WorldPop's open REST API.
 *
 * This is the numeric half of Phase 8: the map may draw a population raster, but "how many people
 * live in this area" is a separate question with a separate answer, and it must be computed by the
 * data provider rather than by summing pixels in the browser.
 *
 * WorldPop's `/services/stats` is asynchronous: it answers with a task id, and the result is read
 * from `/tasks/:id`. That shape is honoured here rather than hidden — a caller gets a clear
 * "pending" instead of a spinner that never resolves if the aggregate takes longer than a request.
 *
 * The unit is deliberately explicit: `people` for the whole polygon, not a density, because
 * density over an arbitrary drawn shape is not a quantity the source publishes.
 */

const WORLDPOP_BASE = "https://api.worldpop.org/v1";
const DATASET = "wpgppop";
const MIN_YEAR = 2000;
const MAX_YEAR = 2020;
const MAX_POLLS = 6;
const POLL_INTERVAL_MS = 1500;

export interface AreaPopulation {
  status: "ready" | "pending" | "unavailable";
  /** Total people estimated inside the polygon. */
  totalPopulation: number | null;
  unit: "people";
  year: number;
  dataset: string;
  /** WorldPop's own bounds for a useful answer. Outside them the source has no data. */
  coverage: "global-land" | "unknown";
  source: {
    id: "worldpop";
    label: "WorldPop (wpgppop)";
    url: string;
    license: string;
    citation: string;
    resolution: string;
  };
  reason?: string;
}

const SOURCE: AreaPopulation["source"] = {
  id: "worldpop",
  label: "WorldPop (wpgppop)",
  url: "https://www.worldpop.org/",
  license: "CC-BY-4.0",
  citation:
    "WorldPop (www.worldpop.org, University of Southampton; University of Louisville; Universite de Namur) and CIESIN",
  resolution: "100 m grid, dasymetric redistribution"
};

function unavailable(reason: string, year: number): AreaPopulation {
  return {
    status: "unavailable",
    totalPopulation: null,
    unit: "people",
    year,
    dataset: DATASET,
    coverage: "unknown",
    source: SOURCE,
    reason
  };
}

/** A bbox as a closed polygon, which is the geometry WorldPop aggregates over. */
export function bboxPolygon(bbox: [number, number, number, number]): {
  type: "Polygon";
  coordinates: number[][][];
} {
  const [west, south, east, north] = bbox;
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south]
      ]
    ]
  };
}

export function clampPopulationYear(year: number | undefined): number {
  if (typeof year !== "number" || !Number.isInteger(year)) return MAX_YEAR;
  return Math.min(Math.max(year, MIN_YEAR), MAX_YEAR);
}

/** The task-id creation response and the task result are different shapes; this reads the id
 *  only from the creation response, where it is the only thing we trust. */
export function taskIdFrom(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const value = (response as { taskid?: unknown }).taskid;
  return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value) ? value : null;
}

export function totalFrom(response: unknown): number | null {
  if (!response || typeof response !== "object") return null;
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const total = (data as { total_population?: unknown }).total_population;
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

export function isFinished(response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  return (response as { status?: unknown }).status === "finished";
}

/**
 * Population of a bbox for a year, from WorldPop.
 *
 * Bounded: the task is polled a fixed number of times. A result that is not ready within that
 * window is reported as `pending` rather than held open, so one slow aggregate cannot tie up a
 * request or a worker.
 */
export async function areaPopulation(
  bbox: [number, number, number, number],
  options: { year?: number; signal?: AbortSignal } = {}
): Promise<AreaPopulation> {
  const year = clampPopulationYear(options.year);
  const geojson = encodeURIComponent(JSON.stringify(bboxPolygon(bbox)));

  let created: unknown;
  try {
    created = await fetchJson<unknown>(
      `${WORLDPOP_BASE}/services/stats?dataset=${DATASET}&year=${year}&geojson=${geojson}`,
      {
        providerId: "worldpop",
        ttlMs: 0,
        timeoutMs: 20_000,
        signal: options.signal
      }
    );
  } catch {
    return unavailable("Součet populace pro oblast se nepodařilo spustit.", year);
  }

  const taskId = taskIdFrom(created);
  if (!taskId) return unavailable("WorldPop nevrátil platný identifikátor úlohy.", year);

  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    const task = await fetchJson<unknown>(`${WORLDPOP_BASE}/tasks/${taskId}`, {
      providerId: "worldpop",
      ttlMs: 0,
      timeoutMs: 15_000,
      signal: options.signal
    }).catch(() => null);
    if (task && isFinished(task)) {
      const totalPopulation = totalFrom(task);
      if (totalPopulation === null) {
        return unavailable("WorldPop pro tuto oblast nevrátil číselný součet.", year);
      }
      return {
        status: "ready",
        totalPopulation,
        unit: "people",
        year,
        dataset: DATASET,
        coverage: "global-land",
        source: SOURCE
      };
    }
    if (attempt < MAX_POLLS - 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  return {
    status: "pending",
    totalPopulation: null,
    unit: "people",
    year,
    dataset: DATASET,
    coverage: "unknown",
    source: SOURCE,
    reason: "WorldPop součet pro tuto oblast ještě běží. Zkus to znovu."
  };
}
