import { searchOfflineGazetteer } from "../../data/offlineGazetteer.js";
import type { AiChatToolProviders } from "./chatTools.js";

const SPEED_MS = { foot: 1.3, bike: 4.5, car: 13 } as const;

function metres(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(h));
}

/**
 * The offline profile's geocoder and router: the gazetteer for names, straight lines for legs.
 * Enough for the assistant to put what it names on the map and join it up without a network;
 * a real deployment composes Mapy/Nominatim and Mapy/OSRM instead. Providers already set win.
 */
export function withOfflinePlaces(providers: AiChatToolProviders): AiChatToolProviders {
  providers.resolveLocation ??= async (query) =>
    searchOfflineGazetteer(query).map((entry) => ({
      name: `${entry.name}, ${entry.hierarchy.join(", ")}`,
      longitude: entry.longitude,
      latitude: entry.latitude
    }));
  providers.routePlan ??= async (stops, profile) => {
    const coordinates = stops.map((stop) => [stop.longitude, stop.latitude] as [number, number]);
    const legs = coordinates.slice(1).map((to, index) => {
      const from = coordinates[index]!;
      const distanceM = Math.round(metres(from, to));
      return {
        coordinates: [from, to],
        distanceM,
        durationS: Math.round(distanceM / SPEED_MS[profile]),
        provider: "osm" as const,
        profile
      };
    });
    return {
      coordinates,
      distanceM: legs.reduce((sum, leg) => sum + leg.distanceM, 0),
      durationS: legs.reduce((sum, leg) => sum + leg.durationS, 0),
      provider: "osm",
      profile,
      legs
    };
  };
  return providers;
}
