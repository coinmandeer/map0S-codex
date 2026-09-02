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

export function legendCompactDescription(legend: LegendManifestV2): string {
  const entries = legendTextEntries(legend);
  if (legend.unit) return `Jednotka ${legend.unit} · ${entries.length} hodnot`;
  if (legend.type === "categorical") return `${entries.length} kategorií`;
  return entries.length ? `${entries.length} hodnot` : "Detail vrstvy";
}
