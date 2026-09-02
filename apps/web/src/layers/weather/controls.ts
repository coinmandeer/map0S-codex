import type { FilterValues } from "@mapos/layer-sdk";
import type { WeatherVariableId } from "./grid";

export type WeatherVisualizationId = "radar" | WeatherVariableId;

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
