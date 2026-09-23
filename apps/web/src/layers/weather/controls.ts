import type { FilterValues } from "@mapos/layer-sdk";
import type { WeatherVariableId } from "./grid";

export type WeatherVisualizationId = "radar" | WeatherVariableId;
export const WEATHER_MODEL_IDS = [
  "best_match",
  "icon_d2",
  "icon_seamless",
  "chmi_aladin_seamless"
] as const;
export type WeatherModelId = (typeof WEATHER_MODEL_IDS)[number];
export function resolveWeatherModel(value: unknown): WeatherModelId {
  return WEATHER_MODEL_IDS.includes(value as WeatherModelId)
    ? (value as WeatherModelId)
    : "best_match";
}

export interface WeatherVisualizationOption {
  id: WeatherVisualizationId;
  label: string;
  unit: string;
  vector: boolean;
  source: "rainviewer" | "open-meteo";
}

/** One exclusive catalogue shared by the Layers drawer, renderer and timeline.
 * Keeping it here prevents separate controls from drifting back into a radar + field stack. */
export const WEATHER_VISUALIZATIONS: readonly WeatherVisualizationOption[] = [
  {
    id: "radar",
    label: "Srážkový radar",
    unit: "intenzita",
    vector: false,
    source: "rainviewer"
  },
  {
    id: "precipitation",
    label: "Srážky",
    unit: "mm",
    vector: false,
    source: "open-meteo"
  },
  {
    id: "temperature",
    label: "Teplota",
    unit: "°C",
    vector: false,
    source: "open-meteo"
  },
  { id: "wind", label: "Vítr", unit: "m/s", vector: true, source: "open-meteo" },
  { id: "gusts", label: "Nárazy", unit: "m/s", vector: false, source: "open-meteo" },
  { id: "clouds", label: "Oblačnost", unit: "%", vector: false, source: "open-meteo" },
  { id: "pressure", label: "Tlak", unit: "hPa", vector: false, source: "open-meteo" },
  { id: "humidity", label: "Vlhkost", unit: "%", vector: false, source: "open-meteo" }
] as const;

const ids = new Set<WeatherVisualizationId>(WEATHER_VISUALIZATIONS.map(({ id }) => id));

export function isWeatherVisualization(value: unknown): value is WeatherVisualizationId {
  return typeof value === "string" && ids.has(value as WeatherVisualizationId);
}

export function isWeatherVariableId(value: unknown): value is WeatherVariableId {
  return isWeatherVisualization(value) && value !== "radar";
}

/** Reads both the new exclusive value and old bookmarked filter shapes.
 * Old links commonly contain `variable` together with radar's former implicit default; an
 * explicit variable wins so the user's last meaningful choice is preserved without stacking. */
export function resolveWeatherVisualization(filters: FilterValues): WeatherVisualizationId {
  if (isWeatherVisualization(filters.visualization)) return filters.visualization;
  if (isWeatherVariableId(filters.variable)) return filters.variable;
  return "radar";
}

/** Canonical exclusive patch. The legacy `radar` and `variable` keys remain populated so older
 * clients and saved URLs continue to understand the selection. */
export function weatherVisualizationFilters(
  current: FilterValues,
  visualization: WeatherVisualizationId
): FilterValues {
  return visualization === "radar"
    ? { ...current, visualization, radar: true, variable: null }
    : { ...current, visualization, radar: false, variable: visualization };
}

export function weatherVisualizationOption(id: WeatherVisualizationId): WeatherVisualizationOption {
  return WEATHER_VISUALIZATIONS.find((option) => option.id === id) ?? WEATHER_VISUALIZATIONS[0]!;
}

/** Every weather quantity is its own registered layer (`weather-radar`, `weather-wind`, …).
 *  The renderer is shared, but the layer identity, visibility, opacity and filters are not — so
 *  the drawer can offer them as ordinary rows and the engine can toggle them independently. */
export const WEATHER_LAYER_PREFIX = "weather-";

export function weatherLayerId(visualization: WeatherVisualizationId): string {
  return `${WEATHER_LAYER_PREFIX}${visualization}`;
}

const WEATHER_LAYER_IDS = new Set<string>(
  WEATHER_VISUALIZATIONS.map((option) => weatherLayerId(option.id))
);

/** True for `weather-radar`, `weather-wind`, … but not the legacy bare `weather` id. */
export function isWeatherLayerId(id: string): boolean {
  return WEATHER_LAYER_IDS.has(id);
}

export function weatherVisualizationOfLayerId(id: string): WeatherVisualizationId | null {
  if (!isWeatherLayerId(id)) return null;
  return id.slice(WEATHER_LAYER_PREFIX.length) as WeatherVisualizationId;
}

/** Radar is the only weather layer whose frames come as tiles rather than a numeric grid. */
export function isWeatherRadarLayerId(id: string): boolean {
  return id === weatherLayerId("radar");
}

/** The first visible weather layer that carries a numeric grid (anything but radar), if any. */
export function firstVisibleWeatherVariableLayer(
  active: Record<string, { visible?: boolean }>
): { id: string; visualization: WeatherVariableId } | null {
  for (const [id, state] of Object.entries(active)) {
    if (!state.visible) continue;
    const visualization = weatherVisualizationOfLayerId(id);
    if (visualization && visualization !== "radar") return { id, visualization };
  }
  return null;
}
