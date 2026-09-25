/**
 * A handful of Czech places for the offline profile.
 *
 * The in-memory server has no geocoder. It used to answer every search with Plzeň, which made
 * "nejchudší obce v ČR" suggest Plzeň and gave the assistant nothing to put on the map. A small
 * gazetteer that only answers when the name actually matches keeps offline development honest:
 * a place it does not know is simply not found.
 */

export interface OfflineGazetteerEntry {
  name: string;
  type: "city" | "town" | "village" | "peak" | "region";
  hierarchy: string[];
  longitude: number;
  latitude: number;
}

export const OFFLINE_GAZETTEER: readonly OfflineGazetteerEntry[] = [
  {
    name: "Plzeň",
    type: "city",
    hierarchy: ["Plzeňský kraj", "Česko"],
    longitude: 13.3775,
    latitude: 49.7475
  },
  {
    name: "Praha",
    type: "city",
    hierarchy: ["Hlavní město Praha", "Česko"],
    longitude: 14.4213,
    latitude: 50.0875
  },
  {
    name: "Brno",
    type: "city",
    hierarchy: ["Jihomoravský kraj", "Česko"],
    longitude: 16.6068,
    latitude: 49.1951
  },
  {
    name: "Ostrava",
    type: "city",
    hierarchy: ["Moravskoslezský kraj", "Česko"],
    longitude: 18.2625,
    latitude: 49.8209
  },
  {
    name: "Olomouc",
    type: "city",
    hierarchy: ["Olomoucký kraj", "Česko"],
    longitude: 17.2509,
    latitude: 49.5938
  },
  {
    name: "Liberec",
    type: "city",
    hierarchy: ["Liberecký kraj", "Česko"],
    longitude: 15.0562,
    latitude: 50.7671
  },
  {
    name: "České Budějovice",
    type: "city",
    hierarchy: ["Jihočeský kraj", "Česko"],
    longitude: 14.4747,
    latitude: 48.9747
  },
  {
    name: "Hradec Králové",
    type: "city",
    hierarchy: ["Královéhradecký kraj", "Česko"],
    longitude: 15.8328,
    latitude: 50.2092
  },
  {
    name: "Karlovy Vary",
    type: "city",
    hierarchy: ["Karlovarský kraj", "Česko"],
    longitude: 12.8712,
    latitude: 50.2319
  },
  {
    name: "Český Krumlov",
    type: "town",
    hierarchy: ["Jihočeský kraj", "Česko"],
    longitude: 14.3175,
    latitude: 48.8127
  },
  {
    name: "Kutná Hora",
    type: "town",
    hierarchy: ["Středočeský kraj", "Česko"],
    longitude: 15.2681,
    latitude: 49.9484
  },
  {
    name: "Vrchlabí",
    type: "town",
    hierarchy: ["Královéhradecký kraj", "Česko"],
    longitude: 15.6094,
    latitude: 50.627
  },
  {
    name: "Pec pod Sněžkou",
    type: "village",
    hierarchy: ["Královéhradecký kraj", "Česko"],
    longitude: 15.7337,
    latitude: 50.6917
  },
  {
    name: "Špindlerův Mlýn",
    type: "town",
    hierarchy: ["Královéhradecký kraj", "Česko"],
    longitude: 15.6093,
    latitude: 50.7259
  },
  {
    name: "Sněžka",
    type: "peak",
    hierarchy: ["Krkonoše", "Česko"],
    longitude: 15.7399,
    latitude: 50.736
  },
  {
    name: "Jihomoravský kraj",
    type: "region",
    hierarchy: ["Česko"],
    longitude: 16.6,
    latitude: 49.0
  }
];

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** Entries whose name the query starts, contains, or is contained in — never a blind default. */
export function searchOfflineGazetteer(query: string, limit = 5): OfflineGazetteerEntry[] {
  const needle = fold(query);
  if (needle.length < 2) return [];
  const scored = OFFLINE_GAZETTEER.map((entry) => {
    const name = fold(entry.name);
    const score =
      name === needle
        ? 3
        : name.startsWith(needle)
          ? 2
          : needle.includes(name) || name.includes(needle)
            ? 1
            : 0;
    return { entry, score };
  }).filter(({ score }) => score > 0);
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry);
}
