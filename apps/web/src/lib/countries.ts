/** Rough map center + span (degrees) for demo POI scatter and map flyTo */
export type CountryMapConfig = {
  centerLat: number;
  centerLng: number;
  spanLat: number;
  spanLng: number;
};

const COUNTRY_SEARCH_ALIASES: Record<string, string[]> = {
  ALL: ["all countries", "all", "everywhere", "evropa", "europe", "vsechny zeme"],
  CZ: ["czechia", "czech republic", "cesko", "ceska republika", "cechy", "bohemia"],
  SK: ["slovakia", "slovensko"],
  PL: ["poland", "polska"],
  DE: ["germany", "deutschland", "nemecko"],
  AT: ["austria", "osterreich", "rakousko"],
  FR: ["france", "francie"],
  IT: ["italy", "italia", "italie"],
  ES: ["spain", "espana", "spanelsko"],
  PT: ["portugal", "portugalsko"],
  GB: ["united kingdom", "uk", "great britain", "england"],
  US: ["united states", "usa", "america"],
  JP: ["japan", "japonsko"],
  AU: ["australia", "australie"]
};

const DEFAULT_CONFIG: CountryMapConfig = {
  centerLat: 20,
  centerLng: 10,
  spanLat: 8,
  spanLng: 12
};

export const COUNTRY_MAP_CONFIG: Record<string, CountryMapConfig> = {
  CZ: { centerLat: 49.75, centerLng: 15.5, spanLat: 2.2, spanLng: 4.5 },
  SK: { centerLat: 48.7, centerLng: 19.5, spanLat: 1.8, spanLng: 3.2 },
  PL: { centerLat: 51.9, centerLng: 19.3, spanLat: 3, spanLng: 4.5 },
  DE: { centerLat: 51.2, centerLng: 10.5, spanLat: 4, spanLng: 5 },
  AT: { centerLat: 47.5, centerLng: 14.5, spanLat: 2.5, spanLng: 4 },
  FR: { centerLat: 46.5, centerLng: 2.5, spanLat: 5, spanLng: 5 },
  IT: { centerLat: 42.8, centerLng: 12.6, spanLat: 4, spanLng: 4 },
  ES: { centerLat: 40.4, centerLng: -3.7, spanLat: 4, spanLng: 5 },
  PT: { centerLat: 39.6, centerLng: -8, spanLat: 2.5, spanLng: 2.5 },
  GB: { centerLat: 54.2, centerLng: -2.5, spanLat: 5, spanLng: 4 },
  NL: { centerLat: 52.2, centerLng: 5.3, spanLat: 1.5, spanLng: 2 },
  CH: { centerLat: 46.9, centerLng: 8.2, spanLat: 1.5, spanLng: 2 },
  HU: { centerLat: 47.2, centerLng: 19.5, spanLat: 2, spanLng: 3 },
  US: { centerLat: 39.8, centerLng: -98.5, spanLat: 12, spanLng: 18 },
  JP: { centerLat: 36.2, centerLng: 138.3, spanLat: 5, spanLng: 6 },
  AU: { centerLat: -25.3, centerLng: 133.8, spanLat: 12, spanLng: 16 }
};

export function getCountryMapConfig(code: string): CountryMapConfig {
  return COUNTRY_MAP_CONFIG[code.toUpperCase()] ?? DEFAULT_CONFIG;
}

export function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isCountryDemoEnabled(code: string): boolean {
  return code.toUpperCase() in COUNTRY_MAP_CONFIG;
}

export function getCountryNameCs(code: string): string {
  const c = code.toUpperCase();
  if (c === "ALL") return "Všechny země";
  try {
    return new Intl.DisplayNames(["cs"], { type: "region" }).of(c) ?? c;
  } catch {
    return c;
  }
}

export function getCountrySearchIndex(code: string, fallbackName?: string) {
  const c = code.toUpperCase();
  const values = [fallbackName ?? "", c, getCountryNameCs(c), ...(COUNTRY_SEARCH_ALIASES[c] ?? [])];
  return Array.from(new Set(values.flatMap((value) => [value, normalizeSearchText(value)])))
    .filter(Boolean)
    .join(" ");
}

let _sorted: { code: string; name: string }[] | null = null;

export function getCountriesSortedCs(): { code: string; name: string }[] {
  if (_sorted) return _sorted;
  const dn = new Intl.DisplayNames(["cs"], { type: "region" });
  const pairs: { code: string; name: string }[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a) + String.fromCharCode(b);
      const name = dn.of(code);
      if (!name || name === code) continue;
      pairs.push({ code, name });
    }
  }
  pairs.sort((x, y) => x.name.localeCompare(y.name, "cs"));
  _sorted = pairs;
  return pairs;
}

export function countryBbox(code: string): [number, number, number, number] {
  const cfg = getCountryMapConfig(code);
  return [
    cfg.centerLng - cfg.spanLng,
    cfg.centerLat - cfg.spanLat,
    cfg.centerLng + cfg.spanLng,
    cfg.centerLat + cfg.spanLat
  ];
}
