import { getFusedPlaces } from "./poiFusionService.js";
import type {
  AdventureCorridorQuery,
  AdventurePlaceSearchResult
} from "./adventureRoutingService.js";

/** Fetches only OSM landmark categories and deduplicates corridor overlap. Two workers keep the
 * server responsive while avoiding a burst of six concurrent Overpass/cache fills. */
export async function findOsmAdventurePlaces(
  corridors: readonly AdventureCorridorQuery[]
): Promise<AdventurePlaceSearchResult> {
  const queue = [...corridors];
  const results: Awaited<ReturnType<typeof getFusedPlaces>>[] = [];
  const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
    let corridor: AdventureCorridorQuery | undefined;
    while ((corridor = queue.shift())) {
      results.push(
        await getFusedPlaces({
          bbox: corridor.bbox,
          categories: [...corridor.categories],
          sources: ["osm"]
        })
      );
    }
  });
  await Promise.all(workers);

  const places = new Map(
    results.flatMap((result) => result.places).map((place) => [place.id, place])
  );
  const sourceStates = new Map<string, { source: string; state: string; count: number }>();
  for (const meta of results.flatMap((result) => result.meta.sources)) {
    const key = `${meta.source}:${meta.state}`;
    const current = sourceStates.get(key);
    sourceStates.set(key, {
      source: meta.source,
      state: meta.state,
      count: (current?.count ?? 0) + meta.count
    });
  }
  return { places: [...places.values()], sourceStates: [...sourceStates.values()] };
}
