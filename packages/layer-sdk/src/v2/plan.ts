import {
  MAPOS_V2_SCHEMA_VERSION,
  assertCompatibleSchema,
  type JsonValue,
  type VersionEnvelope
} from "./common.js";
import type { Position } from "./feature.js";

export const PLAN_DOCUMENT_SCHEMA = "mapos.plan" as const;
export const PLAN_REVISION_SCHEMA = "mapos.plan-revision" as const;

export type PlanStatusV2 = "draft" | "planned" | "active" | "completed" | "archived";
export type PlanVisibilityV2 = "private" | "unlisted" | "public";
export type PlanTravelProfileV2 = "foot" | "bike" | "car" | "moto" | "camper" | "truck";
export type PlanRoutePreferenceV2 = "fast" | "short" | "nohwy" | "adventure";
export type PlanAvoidanceV2 =
  "tolls" | "ferries" | "motorways" | "unpaved" | "low-emission-zones" | "borders";

export interface PlanVehicleV2 {
  profile: PlanTravelProfileV2;
  heightM?: number | null;
  widthM?: number | null;
  lengthM?: number | null;
  weightT?: number | null;
  fuel?: "petrol" | "diesel" | "cng" | "lng" | "phev" | "bev" | "h2" | null;
  euroClass?: string | null;
  evRangeKm?: number | null;
}

export interface PlanRoutePolicyV2 {
  profile: PlanTravelProfileV2;
  preference: PlanRoutePreferenceV2;
  avoid?: PlanAvoidanceV2[];
  autoBasemap?: boolean;
  weatherAlongRoute?: boolean;
  trafficAlongRoute?: boolean;
}

export type PlanStopStatusV2 = "suggested" | "accepted" | "visited" | "skipped";

export interface PlanStopV2 {
  id: string;
  order: number;
  name: string;
  location: { type: "Point"; coordinates: Position };
  sourceFeatureId?: string | null;
  arrivalAt?: string | null;
  departureAt?: string | null;
  dwellMinutes: number;
  notes?: string | null;
  conversationId?: string | null;
  status?: PlanStopStatusV2;
  locked?: boolean;
  constraints?: Record<string, JsonValue>;
}

export interface PlanAnnotationV2 {
  id: string;
  scope: "plan" | "stop" | "segment";
  targetId?: string | null;
  body: string;
  authorId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RouteSegmentStatusV2 = "pending" | "routing" | "ready" | "stale" | "partial" | "failed";

export interface RouteAlternativeV2 {
  id: string;
  providerId: string;
  profile: string;
  preference: PlanRoutePreferenceV2;
  geometry: { type: "LineString"; coordinates: Position[] };
  distanceM: number;
  durationS: number;
  departureAt?: string | null;
  arrivalAt?: string | null;
  warnings: string[];
  restrictions?: JsonValue[];
  toll?: JsonValue;
  weather?: JsonValue;
  computedAt?: string | null;
}

export interface RouteSegmentV2 {
  id: string;
  order: number;
  fromStopId: string;
  toStopId: string;
  policyHash: string;
  status: RouteSegmentStatusV2;
  provider?: string | null;
  providerRequestFingerprint?: string | null;
  profile?: string | null;
  alternatives: RouteAlternativeV2[];
  selectedAlternativeId?: string | null;
  warnings?: string[];
  calculatedAt?: string | null;
  staleReason?: string | null;
  notes?: string | null;
}

export interface PlanDocumentV2 extends VersionEnvelope {
  schema: typeof PLAN_DOCUMENT_SCHEMA;
  schemaVersion: string;
  revision: number;
  name: string;
  description?: string | null;
  status: PlanStatusV2;
  visibility: PlanVisibilityV2;
  ownerId?: string | null;
  timezone?: string | null;
  departureAt?: string | null;
  vehicle?: PlanVehicleV2 | null;
  routePolicy: PlanRoutePolicyV2;
  stops: PlanStopV2[];
  segments: RouteSegmentV2[];
  annotations?: PlanAnnotationV2[];
  conversationIds?: string[];
  activatedLayerIds?: string[];
  metadata?: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
}

export interface PlanTemporalStopContextV2 {
  stopId: string;
  at: string;
  temperatureC: number | null;
  precipitationMm: number | null;
  weatherCode: number | null;
}

export interface PlanTemporalSegmentContextV2 {
  segmentId: string;
  order: number;
  departureAt: string | null;
  arrivalAt: string | null;
  weatherAtArrival: PlanTemporalStopContextV2 | null;
  trafficStatus: "provider-aware" | "unavailable" | "disabled";
  warnings: string[];
}

/** Real, dated context returned separately from route geometry. Unavailable data is explicit;
 * consumers must never infer forecast or traffic values from route duration. */
export interface PlanTemporalContextV2 {
  status: "active" | "inactive";
  planId: string;
  departureAt: string | null;
  generatedAt: string;
  temporalControls: {
    cursor: string | null;
    minimum: string | null;
    maximum: string | null;
  };
  weather: {
    status: "ready" | "unavailable" | "out-of-range" | "disabled";
    sampledStops: number;
    totalStops: number;
    source: { id: string; label: string; url: string } | null;
    reason: string | null;
  };
  traffic: {
    status: "provider-aware" | "unavailable" | "disabled";
    source: { id: string; label: string } | null;
    reason: string | null;
  };
  stops: PlanTemporalStopContextV2[];
  segments: PlanTemporalSegmentContextV2[];
  dataBudget: {
    maxWeatherStops: number;
    sampledStops: number;
    upstreamWeatherRequests: number;
  };
}

export type PlanStopPatchV2 = Partial<Omit<PlanStopV2, "id" | "order">>;

export type PlanCommandV2 =
  | {
      type: "update-plan";
      patch: Partial<
        Pick<
          PlanDocumentV2,
          "name" | "description" | "status" | "visibility" | "conversationIds" | "activatedLayerIds"
        >
      >;
    }
  | { type: "add-stop"; stop: Omit<PlanStopV2, "order">; index: number }
  | { type: "remove-stop"; stopId: string }
  | { type: "move-stop"; stopId: string; toIndex: number }
  | { type: "update-stop"; stopId: string; patch: PlanStopPatchV2 }
  | { type: "set-departure"; departureAt: string | null; timezone?: string | null }
  | { type: "replace-vehicle"; vehicle: PlanVehicleV2 | null }
  | { type: "replace-route-policy"; routePolicy: PlanRoutePolicyV2 }
  | { type: "select-segment-alternative"; segmentId: string; alternativeId: string }
  | { type: "upsert-annotation"; annotation: PlanAnnotationV2 }
  | { type: "remove-annotation"; annotationId: string }
  | { type: "batch"; commands: PlanCommandV2[] };

export interface PlanCommandEnvelopeV2 {
  id: string;
  expectedRevision: number;
  actorId?: string | null;
  issuedAt?: string;
  command: PlanCommandV2;
}

export interface PlanRevisionRecordV2 extends VersionEnvelope {
  schema: typeof PLAN_REVISION_SCHEMA;
  schemaVersion: string;
  revision: number;
  planId: string;
  baseRevision: number;
  commandId: string;
  actorId?: string | null;
  appliedAt: string;
  command: PlanCommandV2;
  affectedSegmentIds: string[];
  previousDocumentHash: string;
}

const PROFILES: ReadonlySet<PlanTravelProfileV2> = new Set([
  "foot",
  "bike",
  "car",
  "moto",
  "camper",
  "truck"
]);
const PREFERENCES: ReadonlySet<PlanRoutePreferenceV2> = new Set([
  "fast",
  "short",
  "nohwy",
  "adventure"
]);
const AVOIDANCES: ReadonlySet<PlanAvoidanceV2> = new Set([
  "tolls",
  "ferries",
  "motorways",
  "unpaved",
  "low-emission-zones",
  "borders"
]);
const SEGMENT_STATUSES: ReadonlySet<RouteSegmentStatusV2> = new Set([
  "pending",
  "routing",
  "ready",
  "stale",
  "partial",
  "failed"
]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required.`);
  }
}

function dateTime(value: unknown, field: string, nullable = false): void {
  if (nullable && value == null) return;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${field} must be a date-time${nullable ? " or null" : ""}.`);
  }
}

function position(value: unknown, field: string): asserts value is Position {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== "number" ||
    typeof value[1] !== "number" ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1]) ||
    value[0] < -180 ||
    value[0] > 180 ||
    value[1] < -90 ||
    value[1] > 90
  ) {
    throw new TypeError(`${field} must be a WGS84 [longitude, latitude] position.`);
  }
}

function assertRoutePolicy(value: unknown): asserts value is PlanRoutePolicyV2 {
  if (!record(value)) throw new TypeError("routePolicy is required.");
  if (!PROFILES.has(value.profile as PlanTravelProfileV2)) {
    throw new TypeError("routePolicy.profile is not supported.");
  }
  if (!PREFERENCES.has(value.preference as PlanRoutePreferenceV2)) {
    throw new TypeError("routePolicy.preference is not supported.");
  }
  if (value.avoid !== undefined) {
    if (!Array.isArray(value.avoid)) throw new TypeError("routePolicy.avoid must be an array.");
    const unique = new Set(value.avoid);
    if (unique.size !== value.avoid.length || value.avoid.some((item) => !AVOIDANCES.has(item))) {
      throw new TypeError("routePolicy.avoid contains duplicate or unsupported values.");
    }
  }
}

function assertStop(value: unknown, order: number): asserts value is PlanStopV2 {
  if (!record(value)) throw new TypeError(`stops[${order}] must be an object.`);
  requiredText(value.id, `stops[${order}].id`);
  requiredText(value.name, `stops[${order}].name`);
  if (value.order !== order) throw new TypeError(`stops[${order}].order must equal ${order}.`);
  if (!record(value.location) || value.location.type !== "Point") {
    throw new TypeError(`stops[${order}].location must be a Point.`);
  }
  position(value.location.coordinates, `stops[${order}].location.coordinates`);
  if (!Number.isInteger(value.dwellMinutes) || Number(value.dwellMinutes) < 0) {
    throw new TypeError(`stops[${order}].dwellMinutes must be a non-negative integer.`);
  }
  if (value.arrivalAt !== undefined) dateTime(value.arrivalAt, `stops[${order}].arrivalAt`, true);
  if (value.departureAt !== undefined) {
    dateTime(value.departureAt, `stops[${order}].departureAt`, true);
  }
}

function assertAlternative(value: unknown, segmentOrder: number, index: number): void {
  const field = `segments[${segmentOrder}].alternatives[${index}]`;
  if (!record(value)) throw new TypeError(`${field} must be an object.`);
  requiredText(value.id, `${field}.id`);
  requiredText(value.providerId, `${field}.providerId`);
  requiredText(value.profile, `${field}.profile`);
  if (!PREFERENCES.has(value.preference as PlanRoutePreferenceV2)) {
    throw new TypeError(`${field}.preference is not supported.`);
  }
  if (!record(value.geometry) || value.geometry.type !== "LineString") {
    throw new TypeError(`${field}.geometry must be a LineString.`);
  }
  if (!Array.isArray(value.geometry.coordinates) || value.geometry.coordinates.length < 2) {
    throw new TypeError(`${field}.geometry must contain at least two positions.`);
  }
  value.geometry.coordinates.forEach((item, positionIndex) =>
    position(item, `${field}.geometry.coordinates[${positionIndex}]`)
  );
  if (
    typeof value.distanceM !== "number" ||
    !Number.isFinite(value.distanceM) ||
    value.distanceM < 0
  ) {
    throw new TypeError(`${field}.distanceM must be non-negative.`);
  }
  if (
    typeof value.durationS !== "number" ||
    !Number.isFinite(value.durationS) ||
    value.durationS < 0
  ) {
    throw new TypeError(`${field}.durationS must be non-negative.`);
  }
  if (
    !Array.isArray(value.warnings) ||
    value.warnings.some((warning) => typeof warning !== "string")
  ) {
    throw new TypeError(`${field}.warnings must be a string array.`);
  }
}

/**
 * Runtime invariant boundary for persisted plans. It deliberately has no maximum stop count;
 * payload/concurrency budgets belong to transports and workers, not to the product document.
 */
export function assertPlanDocumentV2(value: unknown): asserts value is PlanDocumentV2 {
  if (!record(value)) throw new TypeError("Plan document must be an object.");
  requiredText(value.schema, "schema");
  requiredText(value.schemaVersion, "schemaVersion");
  assertCompatibleSchema(
    { schema: value.schema, schemaVersion: value.schemaVersion },
    PLAN_DOCUMENT_SCHEMA
  );
  requiredText(value.id, "id");
  requiredText(value.name, "name");
  if (!Number.isInteger(value.revision) || Number(value.revision) < 1) {
    throw new TypeError("revision must be a positive integer.");
  }
  if (
    !new Set<PlanStatusV2>(["draft", "planned", "active", "completed", "archived"]).has(
      value.status as PlanStatusV2
    )
  ) {
    throw new TypeError("status is not supported.");
  }
  if (
    !new Set<PlanVisibilityV2>(["private", "unlisted", "public"]).has(
      value.visibility as PlanVisibilityV2
    )
  ) {
    throw new TypeError("visibility is not supported.");
  }
  assertRoutePolicy(value.routePolicy);
  const collecting =
    value.status === "draft" &&
    typeof value.metadata === "object" &&
    value.metadata !== null &&
    (value.metadata as Record<string, unknown>)["dev.mapos.collectingStops"] === true;
  if (!Array.isArray(value.stops) || value.stops.length < (collecting ? 1 : 2)) {
    throw new TypeError("stops must contain at least two items.");
  }
  const stops = value.stops;
  const stopIds = new Set<string>();
  stops.forEach((stop, index) => {
    assertStop(stop, index);
    if (stopIds.has(stop.id)) throw new TypeError(`Duplicate stop id "${stop.id}".`);
    stopIds.add(stop.id);
  });
  if (!Array.isArray(value.segments) || value.segments.length !== stops.length - 1) {
    throw new TypeError("segments must contain exactly one item per adjacent stop pair.");
  }
  const segments = value.segments;
  const segmentIds = new Set<string>();
  segments.forEach((segment, index) => {
    if (!record(segment)) throw new TypeError(`segments[${index}] must be an object.`);
    requiredText(segment.id, `segments[${index}].id`);
    requiredText(segment.policyHash, `segments[${index}].policyHash`);
    if (segmentIds.has(segment.id)) throw new TypeError(`Duplicate segment id "${segment.id}".`);
    segmentIds.add(segment.id);
    if (segment.order !== index)
      throw new TypeError(`segments[${index}].order must equal ${index}.`);
    if (segment.fromStopId !== stops[index]!.id || segment.toStopId !== stops[index + 1]!.id) {
      throw new TypeError(`segments[${index}] does not connect adjacent stops.`);
    }
    if (!SEGMENT_STATUSES.has(segment.status as RouteSegmentStatusV2)) {
      throw new TypeError(`segments[${index}].status is not supported.`);
    }
    if (!Array.isArray(segment.alternatives)) {
      throw new TypeError(`segments[${index}].alternatives must be an array.`);
    }
    const alternativeIds = new Set<string>();
    segment.alternatives.forEach((alternative, alternativeIndex) => {
      assertAlternative(alternative, index, alternativeIndex);
      const alternativeId = (alternative as RouteAlternativeV2).id;
      if (alternativeIds.has(alternativeId)) {
        throw new TypeError(`Duplicate alternative id "${alternativeId}".`);
      }
      alternativeIds.add(alternativeId);
    });
    if (
      segment.selectedAlternativeId != null &&
      !alternativeIds.has(String(segment.selectedAlternativeId))
    ) {
      throw new TypeError(`segments[${index}].selectedAlternativeId does not exist.`);
    }
    if (segment.status === "ready" && segment.selectedAlternativeId == null) {
      throw new TypeError(`segments[${index}] is ready without a selected alternative.`);
    }
  });
  if (value.departureAt !== undefined) dateTime(value.departureAt, "departureAt", true);
  dateTime(value.createdAt, "createdAt");
  dateTime(value.updatedAt, "updatedAt");
  if (value.annotations !== undefined) {
    if (!Array.isArray(value.annotations)) throw new TypeError("annotations must be an array.");
    const annotationIds = new Set<string>();
    value.annotations.forEach((annotation, index) => {
      if (!record(annotation)) throw new TypeError(`annotations[${index}] must be an object.`);
      requiredText(annotation.id, `annotations[${index}].id`);
      requiredText(annotation.body, `annotations[${index}].body`);
      if (!["plan", "stop", "segment"].includes(String(annotation.scope))) {
        throw new TypeError(`annotations[${index}].scope is not supported.`);
      }
      if (annotationIds.has(annotation.id)) {
        throw new TypeError(`Duplicate annotation id "${annotation.id}".`);
      }
      annotationIds.add(annotation.id);
      if (annotation.scope === "stop" && !stopIds.has(String(annotation.targetId))) {
        throw new TypeError(`annotations[${index}] targets an unknown stop.`);
      }
      if (annotation.scope === "segment" && !segmentIds.has(String(annotation.targetId))) {
        throw new TypeError(`annotations[${index}] targets an unknown segment.`);
      }
      dateTime(annotation.createdAt, `annotations[${index}].createdAt`);
      dateTime(annotation.updatedAt, `annotations[${index}].updatedAt`);
    });
  }
}

export function isPlanDocumentV2(value: unknown): value is PlanDocumentV2 {
  try {
    assertPlanDocumentV2(value);
    return true;
  } catch {
    return false;
  }
}

function canonicalPolicyObject(policy: PlanRoutePolicyV2, vehicle?: PlanVehicleV2 | null) {
  return {
    profile: policy.profile,
    preference: policy.preference,
    avoid: [...new Set(policy.avoid ?? [])].sort(),
    autoBasemap: policy.autoBasemap ?? false,
    weatherAlongRoute: policy.weatherAlongRoute ?? false,
    trafficAlongRoute: policy.trafficAlongRoute ?? false,
    vehicle: vehicle
      ? {
          profile: vehicle.profile,
          heightM: vehicle.heightM ?? null,
          widthM: vehicle.widthM ?? null,
          lengthM: vehicle.lengthM ?? null,
          weightT: vehicle.weightT ?? null,
          fuel: vehicle.fuel ?? null,
          euroClass: vehicle.euroClass ?? null,
          evRangeKm: vehicle.evRangeKm ?? null
        }
      : null
  };
}

/** Stable JSON used as the collision-free in-memory route-cache key component. */
export function canonicalPlanRoutingPolicy(
  policy: PlanRoutePolicyV2,
  vehicle?: PlanVehicleV2 | null
): string {
  return JSON.stringify(canonicalPolicyObject(policy, vehicle));
}

function fnv1a(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function stablePlanHash(value: string): string {
  return `${fnv1a(value, 0x811c9dc5)}${fnv1a(value, 0x9e3779b9)}`;
}

export function planRoutePolicyHash(
  policy: PlanRoutePolicyV2,
  vehicle?: PlanVehicleV2 | null
): string {
  return `route-policy-v1:${stablePlanHash(canonicalPlanRoutingPolicy(policy, vehicle))}`;
}

export function planSegmentId(fromStopId: string, toStopId: string): string {
  return `segment:${encodeURIComponent(fromStopId)}:${encodeURIComponent(toStopId)}`;
}

export function createAdjacentPlanSegments(
  stops: readonly PlanStopV2[],
  policyHash: string
): RouteSegmentV2[] {
  return stops.slice(0, -1).map((stop, order) => ({
    id: planSegmentId(stop.id, stops[order + 1]!.id),
    order,
    fromStopId: stop.id,
    toStopId: stops[order + 1]!.id,
    policyHash,
    status: "pending",
    alternatives: []
  }));
}

export function newPlanDocumentVersion(): typeof MAPOS_V2_SCHEMA_VERSION {
  return MAPOS_V2_SCHEMA_VERSION;
}
