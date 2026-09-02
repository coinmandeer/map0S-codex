import type { TripPlan, TripRouteVariant } from "../types.js";
import { MAPOS_V2_SCHEMA_VERSION } from "../v2/common.js";
import {
  PLAN_DOCUMENT_SCHEMA,
  assertPlanDocumentV2,
  createAdjacentPlanSegments,
  planRoutePolicyHash,
  type PlanDocumentV2,
  type PlanRoutePreferenceV2,
  type PlanRoutePolicyV2,
  type PlanStopV2
} from "../v2/plan.js";

export interface PlanV1AdapterOptions {
  now?: string;
  ownerId?: string | null;
  status?: PlanDocumentV2["status"];
}

function validDate(value: string | undefined, fallback: string): string {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

function routePolicy(plan: TripPlan): PlanRoutePolicyV2 {
  return {
    profile: plan.vehicle.profile,
    preference: plan.variant,
    ...(plan.variant === "nohwy" ? { avoid: ["motorways" as const] } : {}),
    autoBasemap: true,
    weatherAlongRoute: true,
    trafficAlongRoute: true
  };
}

/** Promotes the current TripPlan without retaining its 60-stop UI/provider limit. */
export function planV1ToV2(plan: TripPlan, options: PlanV1AdapterOptions = {}): PlanDocumentV2 {
  const now = validDate(options.now, new Date(0).toISOString());
  const createdAt = validDate(plan.createdAt, now);
  const updatedAt = validDate(plan.updatedAt, createdAt);
  const policy = routePolicy(plan);
  const vehicle = { ...plan.vehicle };
  const stops: PlanStopV2[] = plan.stops.map((stop, order) => ({
    id: stop.id,
    order,
    name: stop.name,
    location: { type: "Point", coordinates: [stop.lng, stop.lat] },
    dwellMinutes: stop.dwellMinutes,
    status: "accepted"
  }));
  const document: PlanDocumentV2 = {
    schema: PLAN_DOCUMENT_SCHEMA,
    schemaVersion: MAPOS_V2_SCHEMA_VERSION,
    id: plan.id,
    revision: 1,
    name: plan.name,
    status: options.status ?? "draft",
    visibility: plan.visibility,
    ...(options.ownerId !== undefined ? { ownerId: options.ownerId } : {}),
    departureAt: validDate(plan.departureAt, updatedAt),
    vehicle,
    routePolicy: policy,
    stops,
    segments: createAdjacentPlanSegments(stops, planRoutePolicyHash(policy, vehicle)),
    metadata: {
      "dev.mapos.migration": {
        sourceSchema: "TripPlan",
        sourceVersion: "1"
      }
    },
    createdAt,
    updatedAt
  };
  assertPlanDocumentV2(document);
  return document;
}

function legacyVariant(preference: PlanRoutePreferenceV2): TripRouteVariant {
  return preference === "adventure" ? "fast" : preference;
}

/** Loss-aware compatibility projection for clients that still speak TripPlan v1. */
export function planV2ToV1(document: PlanDocumentV2): TripPlan {
  assertPlanDocumentV2(document);
  return {
    id: document.id,
    name: document.name,
    departureAt: document.departureAt ?? document.updatedAt,
    variant: legacyVariant(document.routePolicy.preference),
    stops: document.stops.map((stop) => ({
      id: stop.id,
      name: stop.name,
      lng: stop.location.coordinates[0],
      lat: stop.location.coordinates[1],
      dwellMinutes: stop.dwellMinutes
    })),
    vehicle: {
      profile: document.vehicle?.profile ?? document.routePolicy.profile,
      ...(document.vehicle?.heightM !== undefined ? { heightM: document.vehicle.heightM } : {}),
      ...(document.vehicle?.widthM !== undefined ? { widthM: document.vehicle.widthM } : {}),
      ...(document.vehicle?.weightT !== undefined ? { weightT: document.vehicle.weightT } : {}),
      ...(document.vehicle?.fuel !== undefined ? { fuel: document.vehicle.fuel } : {}),
      ...(document.vehicle?.euroClass !== undefined
        ? { euroClass: document.vehicle.euroClass }
        : {}),
      ...(document.vehicle?.evRangeKm !== undefined
        ? { evRangeKm: document.vehicle.evRangeKm }
        : {})
    },
    visibility: document.visibility,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}
