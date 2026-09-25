import type { LegendManifestV2 } from "@mapos/layer-sdk";

export interface LegendTextEntry {
  label: string;
  color?: string;
  icon?: string;
}

export function legendTextEntries(legend: LegendManifestV2): LegendTextEntry[] {
  if (legend.items?.length) {
    return legend.items.map((item) => ({
      label: item.description ? `${item.label} — ${item.description}` : item.label,
      ...(item.color ? { color: item.color } : {}),
      ...(item.icon ? { icon: item.icon } : {})
    }));
  }
  if (legend.stops?.length) {
    return legend.stops.map((stop) => ({
      label: `${stop.label}${legend.unit ? ` ${legend.unit}` : ""}`,
      ...(stop.color ? { color: stop.color } : {})
    }));
  }

  const suffix = legend.unit ? ` ${legend.unit}` : "";
  return [
    ...(typeof legend.min === "number" ? [{ label: `Minimum ${legend.min}${suffix}` }] : []),
    ...(typeof legend.max === "number" ? [{ label: `Maximum ${legend.max}${suffix}` }] : [])
  ];
}

/** How one layer's legend is drawn in the 40 px footer row (§4.11). Continuous scales become a
 *  gradient bar, categories a few swatches, magnitudes three circles — anything else falls back
 *  to the sentence the tray already showed. */
export type LegendVisual =
  | { kind: "gradient"; colors: string[]; min: string; max: string }
  | { kind: "swatches"; entries: LegendTextEntry[]; overflow: number }
  | { kind: "sizes"; entries: LegendTextEntry[] }
  | { kind: "text"; description: string };

const SWATCH_CAPACITY = 5;

export function legendVisual(legend: LegendManifestV2): LegendVisual {
  const entries = legendTextEntries(legend);
  const suffix = legend.unit ? ` ${legend.unit}` : "";
  const stopColors = (legend.stops ?? [])
    .map((stop) => stop.color)
    .filter((color): color is string => Boolean(color));

  if (legend.type === "continuous" && stopColors.length >= 2) {
    const stops = legend.stops!;
    return {
      kind: "gradient",
      colors: stopColors,
      min: `${stops[0]!.label}${suffix}`,
      max: `${stops[stops.length - 1]!.label}${suffix}`
    };
  }

  if (legend.type === "numeric" && legend.stops?.length) {
    const stops = legend.stops;
    const picked = [stops[0]!, stops[Math.floor((stops.length - 1) / 2)]!, stops.at(-1)!];
    return {
      kind: "sizes",
      entries: picked.map((stop) => ({
        label: `${stop.label}${suffix}`,
        ...(stop.color ? { color: stop.color } : {})
      }))
    };
  }

  if (entries.some((entry) => entry.color || entry.icon)) {
    return {
      kind: "swatches",
      entries: entries.slice(0, SWATCH_CAPACITY),
      overflow: Math.max(0, entries.length - SWATCH_CAPACITY)
    };
  }

  return { kind: "text", description: legendCompactDescription(legend) };
}

export function legendCompactDescription(legend: LegendManifestV2): string {
  const entries = legendTextEntries(legend);
  // Legend stops describe a scale, not the number of observations on the map.
  if (legend.unit) return `Jednotka ${legend.unit}`;
  if (legend.type === "categorical") return `${entries.length} kategorií`;
  return entries.length ? "Stupnice hodnot" : "Detail vrstvy";
}
