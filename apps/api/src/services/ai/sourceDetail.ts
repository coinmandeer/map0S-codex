import { getPlaceDetail } from "../placeDetailService.js";
import { satelliteById, SATELLITE_CATEGORIES } from "../satelliteService.js";
import type { Place } from "@mapos/layer-sdk";

export const AI_PLACE_FIELDS = [
  "name",
  "category",
  "description",
  "address",
  "openingHours",
  "website",
  "elevationM",
  "wikidata",
  "lng",
  "lat"
] as const;
/** Explicit source bindings: a layer id is not permission to resolve an arbitrary foreign id. */
export function sourceIdForTarget(layerId: string, featureId: string): string | null {
  if (
    (layerId === "osm-poi" || layerId === "vanlife" || layerId.startsWith("osm-")) &&
    /^(?:osm:(?:node|way|relation):\d+|osm-\d+)$/.test(featureId)
  )
    return featureId;
  if (layerId === "park4night" && /^(park4night:)?\d+$/.test(featureId))
    return featureId.startsWith("park4night:") ? featureId : `park4night:${featureId}`;
  if (layerId.startsWith("wikidata") && /^(wikidata:)?Q\d+$/.test(featureId))
    return featureId.startsWith("wikidata:") ? featureId : `wikidata:${featureId}`;
  if (layerId.startsWith("mapy") && /^mapy:[\w:.-]+$/.test(featureId)) return featureId;
  if (layerId === "satellites" && /^\d{1,10}$/.test(featureId)) return `satellite:${featureId}`;
  return null;
}
export async function sourcePlaceDetail(
  input: { layerId: string; featureId: string; lng?: number; lat?: number },
  signal: AbortSignal
) {
  const id = sourceIdForTarget(input.layerId, input.featureId);
  if (!id) throw new Error("Zdrojovou identitu tohoto místa zatím neumíme ověřit.");

  if (id.startsWith("satellite:")) {
    const lng = input.lng;
    const lat = input.lat;
    if (
      typeof lng !== "number" ||
      typeof lat !== "number" ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      Math.abs(lng) > 180 ||
      Math.abs(lat) > 90
    )
      throw new Error("Poloha družice chybí; přehled nelze sestavit.");
    const element = await satelliteById(id.slice(10), signal);
    if (!element) throw new Error("Družice už není v aktuálním katalogu.");
    const categoryLabel =
      SATELLITE_CATEGORIES.find((category) => category.id === element.category)?.label ?? "Družice";
    return {
      place: {
        id,
        name: element.name,
        lng,
        lat,
        category: element.category,
        // Provenance travels with the place but is only consumed by the overview pipeline, which
        // reads name/lng/lat; CelesTrak is not a place source in the picker catalog.
        sources: [
          {
            source: "celestrak",
            sourceRef: `satellite:${element.id}`,
            confidence: 1,
            refreshedAt: element.epoch
          }
        ] as unknown as Place["sources"]
      },
      fields: {
        name: element.name,
        category: categoryLabel,
        epoch: element.epoch
      },
      source: {
        sourceId: `record:${id}`,
        label: element.name,
        url: `https://celestrak.org/satcat/record.php?CATNR=${element.id}`,
        providerId: "celestrak"
      }
    };
  }

  const place = await getPlaceDetail({ id }, { enrichment: false, signal });
  if (!place) throw new Error("Zdrojový záznam není dostupný.");
  const fields = Object.fromEntries(
    AI_PLACE_FIELDS.flatMap((key) => (place[key] == null ? [] : [[key, place[key]]]))
  );
  const url = /^osm-\d+$/.test(id)
    ? `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lng}#map=17/${place.lat}/${place.lng}`
    : id.startsWith("osm:")
      ? `https://www.openstreetmap.org/${id.split(":").slice(1).join("/")}`
      : id.startsWith("wikidata:")
        ? `https://www.wikidata.org/wiki/${id.slice(9)}`
        : undefined;
  return {
    place,
    fields,
    source: {
      sourceId: `record:${id}`,
      label: place.name,
      ...(url ? { url } : {}),
      providerId: id.startsWith("osm-") ? "osm" : id.split(":")[0]!
    }
  };
}
