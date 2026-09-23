/**
 * The place tools behind the assistant (§30.4): `search_places` and the generalised
 * `find_nearest_poi`.
 *
 * Both read the same fusion pipeline the map reads, so an answer can always be checked against
 * what a user sees after turning the layer on. Categories are named for the model in
 * `group.category` form (`food.bar`, `services.parking`) because a bare `bar` says nothing about
 * what else it could have asked for; a bare id is still accepted.
 */

import { createHash } from "node:crypto";
import type {
  AreaSelection,
  Bbox,
  OsmPoiCategoryId,
  Place,
  PlacesResponse
} from "@mapos/layer-sdk";
import { OSM_POI_CATEGORIES } from "@mapos/layer-sdk";
import type { AiCitation } from "./contracts.js";
import type { AiNearestPoiRecord, AiNearestPoiSource } from "./toolCatalog.js";
import { deterministicDistanceMeters } from "./toolCatalog.js";
import type { AiToolExecutionContext } from "./toolRegistry.js";

const OSM_LAYER_ID = "osm-poi";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Model-facing name for every category the map can draw, plus the bare id as an alias. */
const CATEGORY_BY_TOOL_ID = new Map<string, OsmPoiCategoryId>();
const TOOL_ID_BY_CATEGORY = new Map<OsmPoiCategoryId, string>();
for (const [id, definition] of Object.entries(OSM_POI_CATEGORIES)) {
  const categoryId = id as OsmPoiCategoryId;
  const toolId = `${definition.group}.${categoryId}`;
  CATEGORY_BY_TOOL_ID.set(toolId, categoryId);
  CATEGORY_BY_TOOL_ID.set(categoryId, categoryId);
  TOOL_ID_BY_CATEGORY.set(categoryId, toolId);
}

export function aiCategoryLabel(toolId: string): string | undefined {
  const category = CATEGORY_BY_TOOL_ID.get(toolId);
  return category ? OSM_POI_CATEGORIES[category].label : undefined;
}

export function aiCategoryToolIds(): readonly string[] {
  return [...TOOL_ID_BY_CATEGORY.values()];
}

/** Czech and English words that name a category, so a question can pick layers without a model
 *  (§30.4 point 4). Matched on whole words to keep "barva" out of the bars. */
const CATEGORY_KEYWORDS: readonly (readonly [OsmPoiCategoryId, readonly string[]])[] = [
  ["bar", ["bar", "bary", "hospoda", "hospody", "pub", "pivo"]],
  ["cafe", ["kavárna", "kavárny", "cafe", "café", "káva"]],
  ["restaurant", ["restaurace", "restaurant", "jídlo", "oběd", "večeře"]],
  ["brewery", ["pivovar", "pivovary", "brewery"]],
  ["camp_site", ["kemp", "kempy", "kempu", "kempem", "camping", "campsite", "tábořiště"]],
  ["caravan_site", ["karavan", "karavany", "obytný", "obytným", "caravan", "autokemp"]],
  // Not a bare "voda": "kemp u vody" is a camp by a lake, not a drinking fountain.
  ["drinking_water", ["pitná", "pitnou", "pitné", "vodovod"]],
  ["dump_station", ["výlevka", "chemické", "dump"]],
  ["toilets", ["wc", "toaleta", "toalety", "záchod"]],
  ["shower", ["sprcha", "sprchy", "shower"]],
  ["parking", ["parkoviště", "parkování", "parking", "zaparkovat"]],
  ["fuel", ["benzín", "benzínka", "čerpací", "fuel", "nafta"]],
  ["charging", ["nabíječka", "nabíjení", "charger", "charging"]],
  ["viewpoint", ["vyhlídka", "vyhlídky", "výhled", "viewpoint"]],
  ["waterfall", ["vodopád", "vodopády", "waterfall"]],
  ["lake", ["jezero", "jezera", "přehrada", "rybník", "lake"]],
  ["peak", ["vrchol", "vrcholy", "kopec", "hora", "peak"]],
  ["observation_tower", ["rozhledna", "rozhledny", "tower"]],
  ["cave", ["jeskyně", "cave"]],
  ["castle", ["hrad", "hrady", "hradu", "castle"]],
  ["palace", ["zámek", "zámky", "zámku", "palace"]],
  ["ruins", ["zřícenina", "zříceniny", "ruins"]],
  ["museum", ["muzeum", "muzea", "museum"]],
  ["monument", ["pomník", "pomníky", "památník", "monument"]],
  ["shop", ["obchod", "obchody", "supermarket", "shop"]]
];

/** Categories a question is asking about, most specific first. Empty when nothing matched — the
 *  caller then has to decide between asking the model and saying it did not understand. */
export function inferAiCategories(prompt: string): readonly string[] {
  const words = new Set(
    prompt
      .toLocaleLowerCase("cs-CZ")
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
  );
  const matched: string[] = [];
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => words.has(keyword))) {
      matched.push(TOOL_ID_BY_CATEGORY.get(category)!);
    }
  }
  return matched;
}

export function resolveOsmCategories(toolIds: readonly string[]): OsmPoiCategoryId[] {
  const resolved = new Set<OsmPoiCategoryId>();
  for (const toolId of toolIds) {
    const category = CATEGORY_BY_TOOL_ID.get(toolId);
    if (category) resolved.add(category);
  }
  return [...resolved];
}

export interface AiPlaceSearchQuery {
  area?: AreaSelection | null;
  query?: string;
  categories?: readonly string[];
  near?: { longitude: number; latitude: number };
  bbox?: Bbox;
  radiusMeters?: number;
  filters?: { openNow?: boolean; minRating?: number; tags?: readonly string[] };
  limit: number;
}

export interface AiPlaceSearchRecord {
  sourceFeatureId?: string;
  id: string;
  layerId: string;
  title: string;
  category: string;
  longitude: number;
  latitude: number;
  distanceMeters?: number;
  rating?: number;
  openNow?: boolean;
  tags?: string[];
  sourceId: string;
}

export interface AiPlaceSearchOutput {
  places: AiPlaceSearchRecord[];
  sources: AiCitation[];
}

export interface AiPlaceSearchSource {
  search(query: AiPlaceSearchQuery, context: AiToolExecutionContext): Promise<AiPlaceSearchOutput>;
}

export type FusedPlacesSearchReader = (query: {
  area?: AreaSelection | null;
  bbox: Bbox;
  categories: OsmPoiCategoryId[];
  sources: ["osm"];
}) => Promise<PlacesResponse>;

function opaqueId(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

export function bboxAround(longitude: number, latitude: number, radiusMeters: number): Bbox {
  const latitudeDelta = radiusMeters / 111_320;
  const longitudeDelta =
    radiusMeters / (111_320 * Math.max(0.01, Math.cos((latitude * Math.PI) / 180)));
  return [
    Math.max(-180, longitude - longitudeDelta),
    Math.max(-85, latitude - latitudeDelta),
    Math.min(180, longitude + longitudeDelta),
    Math.min(85, latitude + latitudeDelta)
  ];
}

function publicOsmUrl(sourceRef: string): string | undefined {
  return /^(?:node|way|relation)\/[1-9][0-9]*$/u.test(sourceRef)
    ? `https://www.openstreetmap.org/${sourceRef}`
    : undefined;
}

/** One fused place as the model may see it: an opaque id, public fields and its OSM provenance.
 *  A place without OSM provenance is dropped rather than cited to nobody. */
function fusedRecord(place: Place, category: OsmPoiCategoryId): AiNearestPoiRecord | null {
  const provenance = place.sources.find((claim) => claim.source === "osm");
  if (!provenance) return null;
  const url = publicOsmUrl(provenance.sourceRef);
  const tags = place.tags?.filter((tag) => IDENTIFIER.test(tag)).slice(0, 50);
  const rating =
    typeof place.rating === "number" && place.rating >= 0 && place.rating <= 5
      ? place.rating
      : undefined;
  return {
    id: opaqueId("poi", place.id),
    sourceFeatureId: `osm:${provenance.sourceRef.replaceAll("/", ":").replace(/^osm:/, "")}`,
    layerId: OSM_LAYER_ID,
    title: place.name.trim().slice(0, 500),
    category: TOOL_ID_BY_CATEGORY.get(category)!,
    longitude: place.lng,
    latitude: place.lat,
    ...(rating === undefined ? {} : { rating }),
    ...(tags?.length ? { tags } : {}),
    source: {
      sourceId: opaqueId("osm", provenance.sourceRef),
      label: "© OpenStreetMap contributors (ODbL)",
      providerId: "osm",
      retrievedAt: provenance.refreshedAt,
      ...(url ? { url } : {})
    }
  };
}

function matchesFilters(
  record: AiNearestPoiRecord,
  filters: AiPlaceSearchQuery["filters"]
): boolean {
  if (!filters) return true;
  if (filters.openNow !== undefined && record.openNow !== filters.openNow) return false;
  if (
    filters.minRating !== undefined &&
    !(typeof record.rating === "number" && record.rating >= filters.minRating)
  ) {
    return false;
  }
  return (filters.tags ?? []).every((tag) => record.tags?.includes(tag));
}

function matchesQuery(record: AiNearestPoiRecord, query: string | undefined): boolean {
  if (!query?.trim()) return true;
  const needle = query.trim().toLocaleLowerCase("cs-CZ");
  return record.title.toLocaleLowerCase("cs-CZ").includes(needle);
}

function toOutput(
  records: readonly AiNearestPoiRecord[],
  query: AiPlaceSearchQuery
): AiPlaceSearchOutput {
  const reference = query.near;
  const radius = query.radiusMeters;
  const places = records
    .filter((record) => matchesQuery(record, query.query) && matchesFilters(record, query.filters))
    .map((record) => {
      const distanceMeters = reference ? deterministicDistanceMeters(reference, record) : undefined;
      return {
        id: record.id,
        ...(record.sourceFeatureId ? { sourceFeatureId: record.sourceFeatureId } : {}),
        layerId: record.layerId,
        title: record.title,
        category: record.category,
        longitude: record.longitude,
        latitude: record.latitude,
        ...(distanceMeters === undefined ? {} : { distanceMeters }),
        ...(record.rating === undefined ? {} : { rating: record.rating }),
        ...(record.openNow === undefined ? {} : { openNow: record.openNow }),
        ...(record.tags === undefined ? {} : { tags: [...record.tags] }),
        sourceId: record.source.sourceId,
        source: record.source
      };
    })
    .filter(
      (place) =>
        radius === undefined || place.distanceMeters === undefined || place.distanceMeters <= radius
    )
    .sort(
      (a, b) =>
        (a.distanceMeters ?? Number.POSITIVE_INFINITY) -
          (b.distanceMeters ?? Number.POSITIVE_INFINITY) ||
        a.title.localeCompare(b.title, "cs-CZ") ||
        a.id.localeCompare(b.id)
    )
    .slice(0, query.limit);

  const sources = new Map<string, AiCitation>();
  for (const place of places) sources.set(place.source.sourceId, place.source);
  return {
    places: places.map(({ source: _source, ...place }) => place),
    sources: [...sources.values()]
  };
}

/** Production: the fusion pipeline, one bbox request per search. */
export function createFusedPlaceSearchSource(
  readPlaces: FusedPlacesSearchReader
): AiPlaceSearchSource {
  return {
    async search(query, context) {
      context.signal.throwIfAborted();
      const categories = resolveOsmCategories(query.categories ?? []);
      if (!categories.length) return { places: [], sources: [] };
      const bbox =
        query.bbox ??
        (query.near
          ? bboxAround(query.near.longitude, query.near.latitude, query.radiusMeters ?? 10_000)
          : null);
      if (!bbox) return { places: [], sources: [] };
      const response = await readPlaces({
        bbox,
        categories,
        sources: ["osm"],
        ...(query.area ? { area: query.area } : {})
      });
      context.signal.throwIfAborted();
      const records: AiNearestPoiRecord[] = [];
      for (const place of response.places) {
        const category = resolveOsmCategories([place.category]).at(0) ?? categories[0]!;
        const record = fusedRecord(place, category);
        if (record) records.push(record);
      }
      return toOutput(records, query);
    }
  };
}

export interface MemoryPlaceFixture {
  osmId: string;
  category: string;
  name: string;
  lng: number;
  lat: number;
}

/** Offline: visibly labelled fixtures, no public I/O, same shape as production. */
export function createMemoryPlaceSearchSource(
  readFixtures: () => readonly MemoryPlaceFixture[]
): AiPlaceSearchSource {
  return {
    async search(query, context) {
      context.signal.throwIfAborted();
      const categories = new Set(resolveOsmCategories(query.categories ?? []));
      const records = readFixtures()
        .filter((fixture) => categories.has(fixture.category as OsmPoiCategoryId))
        .map((fixture) => ({
          id: opaqueId("fixture-poi", fixture.osmId),
          layerId: OSM_LAYER_ID,
          title: fixture.name,
          category: TOOL_ID_BY_CATEGORY.get(fixture.category as OsmPoiCategoryId)!,
          longitude: fixture.lng,
          latitude: fixture.lat,
          source: {
            sourceId: opaqueId("osm-fixture", fixture.osmId),
            label: "OpenStreetMap deterministic fixture (ODbL)",
            providerId: "osm-fixture",
            retrievedAt: "2026-09-01T00:00:00.000Z"
          }
        }));
      return toOutput(records, query);
    }
  };
}

/** `find_nearest_poi` over any category, expressed through the same search source so the two
 *  tools can never disagree about what is on the map. */
export function nearestPoiSourceFromSearch(source: AiPlaceSearchSource): AiNearestPoiSource {
  return {
    async query(input, context) {
      const { places, sources } = await source.search(
        {
          categories: [input.category],
          near: { longitude: input.longitude, latitude: input.latitude },
          radiusMeters: input.radiusMeters,
          limit: 50
        },
        context
      );
      const citationById = new Map(sources.map((citation) => [citation.sourceId, citation]));
      return places
        .filter((place) => input.layerIds.includes(place.layerId))
        .map((place) => ({
          id: place.id,
          ...(place.sourceFeatureId ? { sourceFeatureId: place.sourceFeatureId } : {}),
          layerId: place.layerId,
          title: place.title,
          category: input.category,
          longitude: place.longitude,
          latitude: place.latitude,
          ...(place.rating === undefined ? {} : { rating: place.rating }),
          ...(place.openNow === undefined ? {} : { openNow: place.openNow }),
          ...(place.tags === undefined ? {} : { tags: place.tags }),
          source: citationById.get(place.sourceId)!
        }))
        .filter((record) => Boolean(record.source));
    }
  };
}
