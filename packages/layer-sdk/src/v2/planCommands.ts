import { MAPOS_V2_SCHEMA_VERSION } from "./common.js";
import {
  PLAN_REVISION_SCHEMA,
  assertPlanDocumentV2,
  planRoutePolicyHash,
  planSegmentId,
  stablePlanHash,
  type PlanAnnotationV2,
  type PlanCommandEnvelopeV2,
  type PlanCommandV2,
  type PlanDocumentV2,
  type PlanRevisionRecordV2,
  type PlanStopV2,
  type RouteSegmentV2
} from "./plan.js";

export class PlanCommandError extends Error {
  readonly name = "PlanCommandError";

  constructor(
    readonly code:
      | "REVISION_CONFLICT"
      | "INVALID_COMMAND"
      | "STOP_NOT_FOUND"
      | "SEGMENT_NOT_FOUND"
      | "ALTERNATIVE_NOT_FOUND",
    message: string
  ) {
    super(message);
  }
}

export interface SegmentReconcileOptions {
  invalidatedStopIds?: ReadonlySet<string>;
  invalidateAll?: boolean;
  staleReason?: string;
}

export interface SegmentReconcileResult {
  segments: RouteSegmentV2[];
  affectedSegmentIds: string[];
}

export interface ApplyPlanCommandOptions {
  now?: () => string;
}

export interface ApplyPlanCommandResult {
  plan: PlanDocumentV2;
  revision: PlanRevisionRecordV2;
  /** Data-only snapshot suitable for an undo stack. */
  undoDocument: PlanDocumentV2;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactObject(
  value: unknown,
  fields: readonly string[],
  label: string
): Record<string, unknown> {
  if (!record(value)) throw new PlanCommandError("INVALID_COMMAND", `${label} must be an object.`);
  const allowed = new Set(fields);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown) {
    throw new PlanCommandError("INVALID_COMMAND", `${label}.${unknown} is not allowed.`);
  }
  return value;
}

function requiredString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PlanCommandError("INVALID_COMMAND", `${label} must be a non-empty string.`);
  }
}

function nullableString(value: unknown, label: string): void {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new PlanCommandError("INVALID_COMMAND", `${label} must be a string or null.`);
  }
}

function dateTime(value: unknown, label: string): void {
  if (value !== null && (typeof value !== "string" || Number.isNaN(Date.parse(value)))) {
    throw new PlanCommandError("INVALID_COMMAND", `${label} must be a date-time or null.`);
  }
}

function stringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new PlanCommandError("INVALID_COMMAND", `${label} must be a string array.`);
  }
}

function point(value: unknown, label: string): void {
  const location = exactObject(value, ["type", "coordinates"], label);
  const coordinates = location.coordinates;
  if (
    location.type !== "Point" ||
    !Array.isArray(coordinates) ||
    coordinates.length !== 2 ||
    typeof coordinates[0] !== "number" ||
    typeof coordinates[1] !== "number" ||
    !Number.isFinite(coordinates[0]) ||
    !Number.isFinite(coordinates[1]) ||
    coordinates[0] < -180 ||
    coordinates[0] > 180 ||
    coordinates[1] < -90 ||
    coordinates[1] > 90
  ) {
    throw new PlanCommandError("INVALID_COMMAND", `${label} must be a WGS84 Point.`);
  }
}

const STOP_PATCH_FIELDS = [
  "name",
  "location",
  "sourceFeatureId",
  "arrivalAt",
  "departureAt",
  "dwellMinutes",
  "notes",
  "conversationId",
  "status",
  "locked",
  "constraints"
] as const;

function stopPatch(value: unknown, label: string): Record<string, unknown> {
  const patch = exactObject(value, STOP_PATCH_FIELDS, label);
  if (patch.name !== undefined) requiredString(patch.name, `${label}.name`);
  if (patch.location !== undefined) point(patch.location, `${label}.location`);
  for (const field of ["sourceFeatureId", "notes", "conversationId"] as const) {
    nullableString(patch[field], `${label}.${field}`);
  }
  for (const field of ["arrivalAt", "departureAt"] as const) {
    if (patch[field] !== undefined) dateTime(patch[field], `${label}.${field}`);
  }
  if (
    patch.dwellMinutes !== undefined &&
    (!Number.isInteger(patch.dwellMinutes) || Number(patch.dwellMinutes) < 0)
  ) {
    throw new PlanCommandError(
      "INVALID_COMMAND",
      `${label}.dwellMinutes must be a non-negative integer.`
    );
  }
  if (
    patch.status !== undefined &&
    !["suggested", "accepted", "visited", "skipped"].includes(String(patch.status))
  ) {
    throw new PlanCommandError("INVALID_COMMAND", `${label}.status is not supported.`);
  }
  if (patch.locked !== undefined && typeof patch.locked !== "boolean") {
    throw new PlanCommandError("INVALID_COMMAND", `${label}.locked must be boolean.`);
  }
  if (patch.constraints !== undefined && !record(patch.constraints)) {
    throw new PlanCommandError("INVALID_COMMAND", `${label}.constraints must be an object.`);
  }
  return patch;
}

function routePolicy(value: unknown, label: string): void {
  const policy = exactObject(
    value,
    ["profile", "preference", "avoid", "autoBasemap", "weatherAlongRoute", "trafficAlongRoute"],
    label
  );
  if (!["foot", "bike", "car", "moto", "camper", "truck"].includes(String(policy.profile))) {
    throw new PlanCommandError("INVALID_COMMAND", `${label}.profile is not supported.`);
  }
  if (!["fast", "short", "nohwy", "adventure"].includes(String(policy.preference))) {
    throw new PlanCommandError("INVALID_COMMAND", `${label}.preference is not supported.`);
  }
  if (policy.avoid !== undefined) {
    stringArray(policy.avoid, `${label}.avoid`);
    const allowed = new Set([
      "tolls",
      "ferries",
      "motorways",
      "unpaved",
      "low-emission-zones",
      "borders"
    ]);
    if (
      new Set(policy.avoid).size !== policy.avoid.length ||
      policy.avoid.some((item) => !allowed.has(item))
    ) {
      throw new PlanCommandError("INVALID_COMMAND", `${label}.avoid is invalid.`);
    }
  }
  for (const field of ["autoBasemap", "weatherAlongRoute", "trafficAlongRoute"] as const) {
    if (policy[field] !== undefined && typeof policy[field] !== "boolean") {
      throw new PlanCommandError("INVALID_COMMAND", `${label}.${field} must be boolean.`);
    }
  }
}

function vehicle(value: unknown, label: string): void {
  if (value === null) return;
  const input = exactObject(
    value,
    ["profile", "heightM", "widthM", "lengthM", "weightT", "fuel", "euroClass", "evRangeKm"],
    label
  );
  if (!["foot", "bike", "car", "moto", "camper", "truck"].includes(String(input.profile))) {
    throw new PlanCommandError("INVALID_COMMAND", `${label}.profile is not supported.`);
  }
  for (const field of ["heightM", "widthM", "lengthM", "weightT", "evRangeKm"] as const) {
    const metric = input[field];
    if (
      metric !== undefined &&
      metric !== null &&
      (typeof metric !== "number" || !Number.isFinite(metric) || metric < 0)
    ) {
      throw new PlanCommandError("INVALID_COMMAND", `${label}.${field} must be non-negative.`);
    }
  }
  if (
    input.fuel !== undefined &&
    !["petrol", "diesel", "cng", "lng", "phev", "bev", "h2", null].includes(
      input.fuel as string | null
    )
  ) {
    throw new PlanCommandError("INVALID_COMMAND", `${label}.fuel is not supported.`);
  }
  nullableString(input.euroClass, `${label}.euroClass`);
}

function annotation(value: unknown, label: string): void {
  const input = exactObject(
    value,
    ["id", "scope", "targetId", "body", "authorId", "createdAt", "updatedAt"],
    label
  );
  requiredString(input.id, `${label}.id`);
  requiredString(input.body, `${label}.body`);
  if (!["plan", "stop", "segment"].includes(String(input.scope))) {
    throw new PlanCommandError("INVALID_COMMAND", `${label}.scope is not supported.`);
  }
  nullableString(input.targetId, `${label}.targetId`);
  nullableString(input.authorId, `${label}.authorId`);
  dateTime(input.createdAt, `${label}.createdAt`);
  dateTime(input.updatedAt, `${label}.updatedAt`);
}

interface CommandValidationBudget {
  descendants: number;
}

function assertPlanCommand(
  value: unknown,
  depth: number,
  budget: CommandValidationBudget
): asserts value is PlanCommandV2 {
  if (depth > 8) {
    throw new PlanCommandError("INVALID_COMMAND", "Batch command nesting is too deep.");
  }
  if (depth > 0) {
    budget.descendants += 1;
    if (budget.descendants > 100) {
      throw new PlanCommandError(
        "INVALID_COMMAND",
        "A batch command tree may contain at most 100 commands."
      );
    }
  }
  if (!record(value) || typeof value.type !== "string") {
    throw new PlanCommandError("INVALID_COMMAND", "command.type is required.");
  }
  switch (value.type) {
    case "update-plan": {
      const command = exactObject(value, ["type", "patch"], "command");
      const patch = exactObject(
        command.patch,
        ["name", "description", "status", "visibility", "conversationIds", "activatedLayerIds"],
        "command.patch"
      );
      if (patch.name !== undefined) requiredString(patch.name, "command.patch.name");
      nullableString(patch.description, "command.patch.description");
      if (
        patch.status !== undefined &&
        !["draft", "planned", "active", "completed", "archived"].includes(String(patch.status))
      ) {
        throw new PlanCommandError("INVALID_COMMAND", "command.patch.status is not supported.");
      }
      if (
        patch.visibility !== undefined &&
        !["private", "unlisted", "public"].includes(String(patch.visibility))
      ) {
        throw new PlanCommandError("INVALID_COMMAND", "command.patch.visibility is not supported.");
      }
      for (const field of ["conversationIds", "activatedLayerIds"] as const) {
        if (patch[field] !== undefined) stringArray(patch[field], `command.patch.${field}`);
      }
      break;
    }
    case "add-stop": {
      const command = exactObject(value, ["type", "stop", "index"], "command");
      const stop = exactObject(command.stop, ["id", ...STOP_PATCH_FIELDS], "command.stop");
      requiredString(stop.id, "command.stop.id");
      stopPatch(
        Object.fromEntries(Object.entries(stop).filter(([field]) => field !== "id")),
        "command.stop"
      );
      for (const field of ["name", "location", "dwellMinutes"] as const) {
        if (stop[field] === undefined) {
          throw new PlanCommandError("INVALID_COMMAND", `command.stop.${field} is required.`);
        }
      }
      if (!Number.isInteger(command.index) || Number(command.index) < 0) {
        throw new PlanCommandError("INVALID_COMMAND", "command.index must be non-negative.");
      }
      break;
    }
    case "remove-stop": {
      const command = exactObject(value, ["type", "stopId"], "command");
      requiredString(command.stopId, "command.stopId");
      break;
    }
    case "move-stop": {
      const command = exactObject(value, ["type", "stopId", "toIndex"], "command");
      requiredString(command.stopId, "command.stopId");
      if (!Number.isInteger(command.toIndex) || Number(command.toIndex) < 0) {
        throw new PlanCommandError("INVALID_COMMAND", "command.toIndex must be non-negative.");
      }
      break;
    }
    case "update-stop": {
      const command = exactObject(value, ["type", "stopId", "patch"], "command");
      requiredString(command.stopId, "command.stopId");
      stopPatch(command.patch, "command.patch");
      break;
    }
    case "set-departure": {
      const command = exactObject(value, ["type", "departureAt", "timezone"], "command");
      dateTime(command.departureAt, "command.departureAt");
      nullableString(command.timezone, "command.timezone");
      break;
    }
    case "replace-vehicle": {
      const command = exactObject(value, ["type", "vehicle"], "command");
      vehicle(command.vehicle, "command.vehicle");
      break;
    }
    case "replace-route-policy": {
      const command = exactObject(value, ["type", "routePolicy"], "command");
      routePolicy(command.routePolicy, "command.routePolicy");
      break;
    }
    case "select-segment-alternative": {
      const command = exactObject(value, ["type", "segmentId", "alternativeId"], "command");
      requiredString(command.segmentId, "command.segmentId");
      requiredString(command.alternativeId, "command.alternativeId");
      break;
    }
    case "upsert-annotation": {
      const command = exactObject(value, ["type", "annotation"], "command");
      annotation(command.annotation, "command.annotation");
      break;
    }
    case "remove-annotation": {
      const command = exactObject(value, ["type", "annotationId"], "command");
      requiredString(command.annotationId, "command.annotationId");
      break;
    }
    case "batch": {
      const command = exactObject(value, ["type", "commands"], "command");
      if (!Array.isArray(command.commands) || command.commands.length > 100) {
        throw new PlanCommandError(
          "INVALID_COMMAND",
          "Batch commands must be an array with at most 100 items."
        );
      }
      command.commands.forEach((child) => assertPlanCommand(child, depth + 1, budget));
      break;
    }
    default:
      throw new PlanCommandError("INVALID_COMMAND", `Unsupported command: ${value.type}`);
  }
}

export function assertPlanCommandV2(value: unknown): asserts value is PlanCommandV2 {
  assertPlanCommand(value, 0, { descendants: 0 });
}

export function assertPlanCommandEnvelopeV2(
  value: unknown
): asserts value is PlanCommandEnvelopeV2 {
  const envelope = exactObject(
    value,
    ["id", "expectedRevision", "actorId", "issuedAt", "command"],
    "envelope"
  );
  requiredString(envelope.id, "envelope.id");
  if (!Number.isInteger(envelope.expectedRevision) || Number(envelope.expectedRevision) < 0) {
    throw new PlanCommandError(
      "INVALID_COMMAND",
      "envelope.expectedRevision must be a non-negative integer."
    );
  }
  nullableString(envelope.actorId, "envelope.actorId");
  if (envelope.issuedAt !== undefined) dateTime(envelope.issuedAt, "envelope.issuedAt");
  assertPlanCommandV2(envelope.command);
}

function pairKey(fromStopId: string, toStopId: string): string {
  return JSON.stringify([fromStopId, toStopId]);
}

/** Preserves every still-valid segment and replaces only changed adjacency edges. */
export function reconcileAdjacentPlanSegments(
  stops: readonly PlanStopV2[],
  existingSegments: readonly RouteSegmentV2[],
  policyHash: string,
  options: SegmentReconcileOptions = {}
): SegmentReconcileResult {
  const existingByPair = new Map(
    existingSegments.map((segment) => [pairKey(segment.fromStopId, segment.toStopId), segment])
  );
  const desiredPairs = new Set<string>();
  const affected = new Set<string>();

  const segments = stops.slice(0, -1).map((stop, order): RouteSegmentV2 => {
    const toStop = stops[order + 1]!;
    const key = pairKey(stop.id, toStop.id);
    desiredPairs.add(key);
    const existing = existingByPair.get(key);
    if (!existing) {
      const id = planSegmentId(stop.id, toStop.id);
      affected.add(id);
      return {
        id,
        order,
        fromStopId: stop.id,
        toStopId: toStop.id,
        policyHash,
        status: "pending",
        alternatives: []
      };
    }

    const invalidated =
      options.invalidateAll === true ||
      existing.policyHash !== policyHash ||
      options.invalidatedStopIds?.has(stop.id) === true ||
      options.invalidatedStopIds?.has(toStop.id) === true;
    if (!invalidated) {
      return {
        ...clone(existing),
        order,
        fromStopId: stop.id,
        toStopId: toStop.id
      };
    }

    affected.add(existing.id);
    return {
      ...clone(existing),
      order,
      fromStopId: stop.id,
      toStopId: toStop.id,
      policyHash,
      status: "stale",
      staleReason:
        options.staleReason ??
        (existing.policyHash !== policyHash ? "route-policy-changed" : "stop-changed")
    };
  });

  for (const segment of existingSegments) {
    if (!desiredPairs.has(pairKey(segment.fromStopId, segment.toStopId))) affected.add(segment.id);
  }
  return { segments, affectedSegmentIds: [...affected].sort() };
}

function normalizeStopOrder(stops: readonly PlanStopV2[]): PlanStopV2[] {
  return stops.map((stop, order) => ({ ...clone(stop), order }));
}

function samePosition(first: PlanStopV2, second: PlanStopV2): boolean {
  return (
    first.location.coordinates[0] === second.location.coordinates[0] &&
    first.location.coordinates[1] === second.location.coordinates[1]
  );
}

function pruneDanglingAnnotations(plan: PlanDocumentV2): PlanAnnotationV2[] | undefined {
  if (!plan.annotations) return undefined;
  const stopIds = new Set(plan.stops.map((stop) => stop.id));
  const segmentIds = new Set(plan.segments.map((segment) => segment.id));
  return plan.annotations.filter(
    (annotation) =>
      annotation.scope === "plan" ||
      (annotation.scope === "stop" && stopIds.has(String(annotation.targetId))) ||
      (annotation.scope === "segment" && segmentIds.has(String(annotation.targetId)))
  );
}

interface CoreResult {
  plan: PlanDocumentV2;
  affectedSegmentIds: string[];
}

function coreCommand(plan: PlanDocumentV2, command: PlanCommandV2, depth = 0): CoreResult {
  if (depth > 8) {
    throw new PlanCommandError("INVALID_COMMAND", "Batch command nesting is too deep.");
  }
  const next = clone(plan);
  const affected = new Set<string>();
  const policyHash = () => planRoutePolicyHash(next.routePolicy, next.vehicle);
  const reconcile = (options: SegmentReconcileOptions = {}) => {
    const result = reconcileAdjacentPlanSegments(next.stops, next.segments, policyHash(), options);
    next.segments = result.segments;
    result.affectedSegmentIds.forEach((id) => affected.add(id));
    next.annotations = pruneDanglingAnnotations(next);
  };

  switch (command.type) {
    case "update-plan": {
      for (const field of [
        "name",
        "description",
        "status",
        "visibility",
        "conversationIds",
        "activatedLayerIds"
      ] as const) {
        if (command.patch[field] !== undefined) {
          Object.assign(next, { [field]: clone(command.patch[field]) });
        }
      }
      break;
    }
    case "add-stop": {
      if (
        !Number.isInteger(command.index) ||
        command.index < 0 ||
        command.index > next.stops.length
      ) {
        throw new PlanCommandError("INVALID_COMMAND", "Stop insertion index is out of range.");
      }
      if (next.stops.some((stop) => stop.id === command.stop.id)) {
        throw new PlanCommandError("INVALID_COMMAND", `Stop "${command.stop.id}" already exists.`);
      }
      next.stops.splice(command.index, 0, { ...clone(command.stop), order: command.index });
      next.stops = normalizeStopOrder(next.stops);
      reconcile({ staleReason: "stop-added" });
      break;
    }
    case "remove-stop": {
      if (
        next.stops.length <=
        (next.status === "draft" && next.metadata?.["dev.mapos.collectingStops"] === true ? 1 : 2)
      ) {
        throw new PlanCommandError("INVALID_COMMAND", "A plan must retain at least two stops.");
      }
      const index = next.stops.findIndex((stop) => stop.id === command.stopId);
      if (index < 0) throw new PlanCommandError("STOP_NOT_FOUND", "Stop was not found.");
      next.stops.splice(index, 1);
      next.stops = normalizeStopOrder(next.stops);
      reconcile({ staleReason: "stop-removed" });
      break;
    }
    case "move-stop": {
      const index = next.stops.findIndex((stop) => stop.id === command.stopId);
      if (index < 0) throw new PlanCommandError("STOP_NOT_FOUND", "Stop was not found.");
      if (
        !Number.isInteger(command.toIndex) ||
        command.toIndex < 0 ||
        command.toIndex >= next.stops.length
      ) {
        throw new PlanCommandError("INVALID_COMMAND", "Stop destination index is out of range.");
      }
      const [moved] = next.stops.splice(index, 1);
      next.stops.splice(command.toIndex, 0, moved!);
      next.stops = normalizeStopOrder(next.stops);
      reconcile({ staleReason: "stop-moved" });
      break;
    }
    case "update-stop": {
      const index = next.stops.findIndex((stop) => stop.id === command.stopId);
      if (index < 0) throw new PlanCommandError("STOP_NOT_FOUND", "Stop was not found.");
      const before = next.stops[index]!;
      const updated: PlanStopV2 = {
        ...before,
        ...clone(command.patch),
        id: before.id,
        order: before.order
      };
      next.stops[index] = updated;
      reconcile(
        samePosition(before, updated)
          ? {}
          : { invalidatedStopIds: new Set([command.stopId]), staleReason: "stop-location-changed" }
      );
      break;
    }
    case "set-departure": {
      next.departureAt = command.departureAt;
      if (command.timezone !== undefined) next.timezone = command.timezone;
      break;
    }
    case "replace-vehicle": {
      next.vehicle = clone(command.vehicle);
      if (next.vehicle) next.routePolicy.profile = next.vehicle.profile;
      reconcile({ invalidateAll: true, staleReason: "vehicle-changed" });
      break;
    }
    case "replace-route-policy": {
      next.routePolicy = clone(command.routePolicy);
      reconcile({ invalidateAll: true, staleReason: "route-policy-changed" });
      break;
    }
    case "select-segment-alternative": {
      const segment = next.segments.find((item) => item.id === command.segmentId);
      if (!segment) throw new PlanCommandError("SEGMENT_NOT_FOUND", "Segment was not found.");
      if (!segment.alternatives.some((alternative) => alternative.id === command.alternativeId)) {
        throw new PlanCommandError("ALTERNATIVE_NOT_FOUND", "Route alternative was not found.");
      }
      segment.selectedAlternativeId = command.alternativeId;
      break;
    }
    case "upsert-annotation": {
      const annotations = next.annotations ?? [];
      const index = annotations.findIndex((annotation) => annotation.id === command.annotation.id);
      if (index < 0) annotations.push(clone(command.annotation));
      else annotations[index] = clone(command.annotation);
      next.annotations = annotations;
      break;
    }
    case "remove-annotation": {
      next.annotations = (next.annotations ?? []).filter(
        (annotation) => annotation.id !== command.annotationId
      );
      break;
    }
    case "batch": {
      if (command.commands.length > 100) {
        throw new PlanCommandError("INVALID_COMMAND", "Batch commands are limited to 100 items.");
      }
      let working = next;
      for (const child of command.commands) {
        const result = coreCommand(working, child, depth + 1);
        working = result.plan;
        result.affectedSegmentIds.forEach((id) => affected.add(id));
      }
      return { plan: working, affectedSegmentIds: [...affected].sort() };
    }
    default: {
      const exhaustive: never = command;
      throw new PlanCommandError("INVALID_COMMAND", `Unsupported command: ${String(exhaustive)}`);
    }
  }
  return { plan: next, affectedSegmentIds: [...affected].sort() };
}

function appliedAt(now: (() => string) | undefined): string {
  const value = now?.() ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(value))) {
    throw new PlanCommandError("INVALID_COMMAND", "Command clock returned an invalid date-time.");
  }
  return new Date(value).toISOString();
}

/** Applies manual and AI mutations through the same optimistic-revision boundary. */
export function applyPlanCommand(
  document: PlanDocumentV2,
  envelope: PlanCommandEnvelopeV2,
  options: ApplyPlanCommandOptions = {}
): ApplyPlanCommandResult {
  assertPlanDocumentV2(document);
  assertPlanCommandEnvelopeV2(envelope);
  if (envelope.expectedRevision !== document.revision) {
    throw new PlanCommandError(
      "REVISION_CONFLICT",
      `Expected revision ${envelope.expectedRevision}, current revision is ${document.revision}.`
    );
  }
  if (!envelope.id.trim()) {
    throw new PlanCommandError("INVALID_COMMAND", "Command id is required.");
  }
  const undoDocument = clone(document);
  const result = coreCommand(document, envelope.command);
  const time = appliedAt(options.now);
  result.plan.revision = document.revision + 1;
  result.plan.updatedAt = time;
  assertPlanDocumentV2(result.plan);
  const revision: PlanRevisionRecordV2 = {
    schema: PLAN_REVISION_SCHEMA,
    schemaVersion: MAPOS_V2_SCHEMA_VERSION,
    id: `${document.id}:revision:${result.plan.revision}`,
    revision: result.plan.revision,
    planId: document.id,
    baseRevision: document.revision,
    commandId: envelope.id,
    ...(envelope.actorId !== undefined ? { actorId: envelope.actorId } : {}),
    appliedAt: time,
    command: clone(envelope.command),
    affectedSegmentIds: result.affectedSegmentIds,
    previousDocumentHash: stablePlanHash(JSON.stringify(undoDocument))
  };
  return { plan: result.plan, revision, undoDocument };
}

/** Undo is itself a revision; persisted revision numbers therefore never move backwards. */
export function restorePlanSnapshot(
  current: PlanDocumentV2,
  snapshot: PlanDocumentV2,
  options: ApplyPlanCommandOptions = {}
): PlanDocumentV2 {
  assertPlanDocumentV2(current);
  assertPlanDocumentV2(snapshot);
  if (snapshot.id !== current.id) {
    throw new PlanCommandError("INVALID_COMMAND", "Undo snapshot belongs to another plan.");
  }
  const restored = clone(snapshot);
  restored.revision = current.revision + 1;
  restored.updatedAt = appliedAt(options.now);
  assertPlanDocumentV2(restored);
  return restored;
}
