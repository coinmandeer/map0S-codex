import type { DiscoverContext, DiscoverRegionLevel } from "../../discover/context";
import { intlLocale } from "../../i18n";

const LEVEL_LABELS: Record<DiscoverRegionLevel, string> = {
  country: "země",
  admin1: "kraj / region",
  admin2: "okres",
  locality: "město / obec",
  neighbourhood: "čtvrť"
};

export function discoverRegionLevelLabel(level: DiscoverRegionLevel): string {
  return LEVEL_LABELS[level];
}

export function formatStatisticValue(value: number, unit: string): string {
  if (unit === "eur-per-person") {
    return value.toLocaleString(intlLocale(), {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0
    });
  }
  if (unit === "people-per-km2" || unit === "people/km²")
    return `${value.toLocaleString(intlLocale())} obyv./km²`;
  if (unit === "km2") return `${value.toLocaleString(intlLocale())} km²`;
  if (unit === "m") return `${value.toLocaleString(intlLocale())} m n. m.`;
  if (unit === "people") return `${value.toLocaleString(intlLocale())} obyv.`;
  return `${value.toLocaleString(intlLocale(), { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;
}

/** The one-line fact strip under the region name.
 *
 *  Only facts that actually arrived are listed — a missing population is left out rather than
 *  rendered as a dash (§2.6), which is why this returns a joined string and not a fixed grid.
 */
export function discoverFactLine(context: DiscoverContext, placeCount: number): string {
  const parts: string[] = [];
  if (context.region) parts.push(discoverRegionLevelLabel(context.region.level));
  for (const id of ["population", "area", "density", "elevation"]) {
    const statistic = context.statistics.find((candidate) => candidate.id === id);
    if (statistic) parts.push(formatStatisticValue(statistic.value, statistic.unit));
  }
  if (placeCount > 0) parts.push(`${placeCount} ${placeNoun(placeCount)} v mapě`);
  return parts.join(" · ");
}

function placeNoun(count: number): string {
  if (count === 1) return "místo";
  return count >= 2 && count <= 4 ? "místa" : "míst";
}
