import { randomUUID } from "node:crypto";
import type { AiDataClass } from "./contracts.js";

export type AiToolDomain =
  "map" | "layers" | "poi" | "route" | "weather" | "events" | "web" | "plans";

export interface AiToolActor {
  userId?: string;
  authenticated: boolean;
  permissions: ReadonlySet<string>;
  entitlementIds: ReadonlySet<string>;
}

/**
 * Server-produced projection for one AI run. Tool callers cannot expand it: requested layer,
 * feature-field and plan identifiers are checked against these sets again at invocation time.
 */
export interface AiToolPermissionProjection {
  allowedLayerIds: ReadonlySet<string>;
  allowedPlanIds: ReadonlySet<string>;
  allowedFeatureFieldsByLayer: ReadonlyMap<string, ReadonlySet<string>>;
  allowedDataClasses: ReadonlySet<AiDataClass>;
  allowPreciseLocation: boolean;
}

export interface AiToolContext {
  actor: AiToolActor;
  projection: AiToolPermissionProjection;
  signal?: AbortSignal;
}

export interface AiToolPermissionPolicy {
  id: string;
  requiresAuthentication: boolean;
  requiredPermissions: readonly string[];
}

export interface AiToolProjectionPolicy {
  dataClasses: readonly AiDataClass[];
  /** Dot paths whose string/string-array values must all be in allowedLayerIds. */
  layerIdPaths: readonly string[];
  /** Dot paths whose string/string-array values must all be in allowedPlanIds. */
  planIdPaths: readonly string[];
  /** Optional feature-field selection coupled to the layer selected by layerIdPath. */
  featureFields?: { layerIdPath: string; fieldsPath: string };
  /** The tool always handles a precise user coordinate. Conditional cases use authorize. */
  requiresPreciseLocation: boolean;
  /** Reviewed top-level output projection. Output schemas remain the enforcement boundary. */
  outputFields: readonly string[];
}

export interface AiToolAuditPolicy {
  eventType: string;
  /** Documentation for downstream sinks; registry traces never contain any raw values. */
  redactInputPaths: readonly string[];
  redactOutputPaths: readonly string[];
}

export interface AiToolExecutionContext {
  actor: AiToolActor;
  projection: AiToolPermissionProjection;
  signal: AbortSignal;
}

export interface AiToolDefinition<Input, Output> {
  name: string;
  title: string;
  description: string;
  domain: AiToolDomain;
  /** Tools are read-only or produce an unapplied draft. Direct mutation is not representable. */
  effect: "read" | "draft";
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  permissionPolicy: AiToolPermissionPolicy;
  projectionPolicy: AiToolProjectionPolicy;
  auditPolicy: AiToolAuditPolicy;
  timeoutMs: number;
  maxResponseBytes: number;
  quotaCost: number;
  parseInput(value: unknown): Input;
  parseOutput(value: unknown): Output;
  /** Optional object-level policy in addition to the registry's mandatory coarse/projection gate. */
  authorize?(actor: AiToolActor, input: Input, projection: AiToolPermissionProjection): boolean;
  execute(input: Input, context: AiToolExecutionContext): Promise<unknown>;
}

export interface AiToolDescriptor {
  name: string;
  title: string;
  description: string;
  domain: AiToolDomain;
  effect: AiToolDefinition<unknown, unknown>["effect"];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  permissionPolicy: AiToolPermissionPolicy;
  projectionPolicy: AiToolProjectionPolicy;
  auditPolicy: AiToolAuditPolicy;
  timeoutMs: number;
  maxResponseBytes: number;
  quotaCost: number;
}

export type AiToolStatus =
  | "succeeded"
  | "unknown-tool"
  | "invalid-input"
  | "policy-denied"
  | "rate-limited"
  | "timeout"
  | "aborted"
  | "invalid-output"
  | "tool-error";

/** Metadata-only audit record. Actor ids, permission values and tool input/output are absent. */
export interface AiToolTrace {
  invocationId: string;
  toolName: string;
  domain?: AiToolDomain;
  effect?: "read" | "draft";
  permissionPolicyId?: string;
  auditEventType?: string;
  redacted: true;
  status: AiToolStatus;
  durationMs: number;
  quotaCost?: number;
  responseBytes?: number;
}

export type AiToolOutcome<Output> =
  | { status: "succeeded"; value: Output; trace: AiToolTrace }
  | { status: Exclude<AiToolStatus, "succeeded">; trace: AiToolTrace };

export interface AiToolRegistryOptions {
  maxQuotaPerInvocation?: number;
  onTrace?: (trace: AiToolTrace) => void;
}

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const POLICY_ID = /^[a-z][a-z0-9_.:-]{0,127}$/;

function encodedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function valuesAtPath(value: unknown, path: string): string[] | null {
  let cursor = value;
  for (const part of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) return null;
    if (!Object.hasOwn(cursor, part)) return [];
    cursor = (cursor as Record<string, unknown>)[part];
  }
  if (cursor === undefined) return [];
  if (typeof cursor === "string") return [cursor];
  if (Array.isArray(cursor) && cursor.every((entry) => typeof entry === "string")) return cursor;
  return null;
}

function valuesAllowedAtPaths(
  input: unknown,
  paths: readonly string[],
  allowedValues: ReadonlySet<string>
): boolean {
  return paths.every((path) => {
    const values = valuesAtPath(input, path);
    return values !== null && values.every((value) => allowedValues.has(value));
  });
}

function projectionAllows<Input>(
  definition: AiToolDefinition<Input, unknown>,
  input: Input,
  context: AiToolContext
): boolean {
  const { permissionPolicy, projectionPolicy } = definition;
  if (
    permissionPolicy.requiresAuthentication &&
    (!context.actor.authenticated || !context.actor.userId?.trim())
  ) {
    return false;
  }
  if (
    permissionPolicy.requiredPermissions.some(
      (permission) => !context.actor.permissions.has(permission)
    )
  ) {
    return false;
  }
  if (
    projectionPolicy.dataClasses.some(
      (dataClass) => !context.projection.allowedDataClasses.has(dataClass)
    )
  ) {
    return false;
  }
  if (projectionPolicy.requiresPreciseLocation && !context.projection.allowPreciseLocation) {
    return false;
  }
  if (
    !valuesAllowedAtPaths(input, projectionPolicy.layerIdPaths, context.projection.allowedLayerIds)
  ) {
    return false;
  }
  if (
    !valuesAllowedAtPaths(input, projectionPolicy.planIdPaths, context.projection.allowedPlanIds)
  ) {
    return false;
  }
  if (projectionPolicy.featureFields) {
    const layerIds = valuesAtPath(input, projectionPolicy.featureFields.layerIdPath);
    const fields = valuesAtPath(input, projectionPolicy.featureFields.fieldsPath);
    if (layerIds?.length !== 1 || fields === null) return false;
    const allowedFields = context.projection.allowedFeatureFieldsByLayer.get(layerIds[0]!);
    if (!allowedFields || fields.some((field) => !allowedFields.has(field))) return false;
  }
  return definition.authorize?.(context.actor, input, context.projection) ?? true;
}

function validMetadata(definition: AiToolDefinition<unknown, unknown>): boolean {
  return (
    Boolean(definition.title.trim()) &&
    Boolean(definition.description.trim()) &&
    POLICY_ID.test(definition.permissionPolicy.id) &&
    POLICY_ID.test(definition.auditPolicy.eventType) &&
    definition.permissionPolicy.requiredPermissions.every((permission) =>
      POLICY_ID.test(permission)
    ) &&
    definition.projectionPolicy.outputFields.length > 0 &&
    Object.keys(definition.inputSchema).length > 0 &&
    Object.keys(definition.outputSchema).length > 0 &&
    Number.isFinite(definition.timeoutMs) &&
    definition.timeoutMs > 0 &&
    Number.isFinite(definition.maxResponseBytes) &&
    definition.maxResponseBytes > 0 &&
    Number.isFinite(definition.quotaCost) &&
    definition.quotaCost >= 0
  );
}

function snapshotDefinition<Input, Output>(
  definition: AiToolDefinition<Input, Output>
): AiToolDefinition<Input, Output> {
  return {
    ...definition,
    inputSchema: structuredClone(definition.inputSchema),
    outputSchema: structuredClone(definition.outputSchema),
    permissionPolicy: {
      ...definition.permissionPolicy,
      requiredPermissions: [...definition.permissionPolicy.requiredPermissions]
    },
    projectionPolicy: {
      ...definition.projectionPolicy,
      dataClasses: [...definition.projectionPolicy.dataClasses],
      layerIdPaths: [...definition.projectionPolicy.layerIdPaths],
      planIdPaths: [...definition.projectionPolicy.planIdPaths],
      ...(definition.projectionPolicy.featureFields
        ? { featureFields: { ...definition.projectionPolicy.featureFields } }
        : {}),
      outputFields: [...definition.projectionPolicy.outputFields]
    },
    auditPolicy: {
      ...definition.auditPolicy,
      redactInputPaths: [...definition.auditPolicy.redactInputPaths],
      redactOutputPaths: [...definition.auditPolicy.redactOutputPaths]
    }
  };
}

export class AiToolRegistry {
  private readonly definitions = new Map<string, AiToolDefinition<unknown, unknown>>();
  private readonly maxQuotaPerInvocation: number;
  private readonly onTrace?: (trace: AiToolTrace) => void;

  constructor(options: AiToolRegistryOptions = {}) {
    this.maxQuotaPerInvocation = Math.max(0, options.maxQuotaPerInvocation ?? 10);
    this.onTrace = options.onTrace;
  }

  register<Input, Output>(definition: AiToolDefinition<Input, Output>): void {
    if (!TOOL_NAME.test(definition.name)) throw new Error("Invalid AI tool name");
    if (this.definitions.has(definition.name)) throw new Error("Duplicate AI tool name");
    if (!validMetadata(definition as AiToolDefinition<unknown, unknown>)) {
      throw new Error("Invalid AI tool limits, policy or metadata");
    }
    this.definitions.set(
      definition.name,
      snapshotDefinition(definition) as AiToolDefinition<unknown, unknown>
    );
  }

  describe(): AiToolDescriptor[] {
    return [...this.definitions.values()]
      .map(
        ({
          name,
          title,
          description,
          domain,
          effect,
          inputSchema,
          outputSchema,
          permissionPolicy,
          projectionPolicy,
          auditPolicy,
          ...definition
        }) => ({
          name,
          title,
          description,
          domain,
          effect,
          inputSchema: structuredClone(inputSchema),
          outputSchema: structuredClone(outputSchema),
          permissionPolicy: {
            ...permissionPolicy,
            requiredPermissions: [...permissionPolicy.requiredPermissions]
          },
          projectionPolicy: {
            ...projectionPolicy,
            dataClasses: [...projectionPolicy.dataClasses],
            layerIdPaths: [...projectionPolicy.layerIdPaths],
            planIdPaths: [...projectionPolicy.planIdPaths],
            ...(projectionPolicy.featureFields
              ? { featureFields: { ...projectionPolicy.featureFields } }
              : {}),
            outputFields: [...projectionPolicy.outputFields]
          },
          auditPolicy: {
            ...auditPolicy,
            redactInputPaths: [...auditPolicy.redactInputPaths],
            redactOutputPaths: [...auditPolicy.redactOutputPaths]
          },
          timeoutMs: definition.timeoutMs,
          maxResponseBytes: definition.maxResponseBytes,
          quotaCost: definition.quotaCost
        })
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async invoke<Output = unknown>(
    name: string,
    rawInput: unknown,
    context: AiToolContext
  ): Promise<AiToolOutcome<Output>> {
    const invocationId = randomUUID();
    const startedAt = Date.now();
    const definition = this.definitions.get(name);
    const finish = (
      status: AiToolStatus,
      extra: Pick<AiToolTrace, "responseBytes"> = {}
    ): AiToolTrace => {
      const trace: AiToolTrace = {
        invocationId,
        toolName: name,
        redacted: true,
        status,
        durationMs: Math.max(0, Date.now() - startedAt),
        ...(definition
          ? {
              domain: definition.domain,
              effect: definition.effect,
              permissionPolicyId: definition.permissionPolicy.id,
              auditEventType: definition.auditPolicy.eventType,
              quotaCost: definition.quotaCost
            }
          : {}),
        ...extra
      };
      try {
        this.onTrace?.(trace);
      } catch {
        // A telemetry sink is not part of tool correctness.
      }
      return trace;
    };

    if (!definition) return { status: "unknown-tool", trace: finish("unknown-tool") };
    if (definition.quotaCost > this.maxQuotaPerInvocation) {
      return { status: "rate-limited", trace: finish("rate-limited") };
    }

    let input: unknown;
    try {
      input = definition.parseInput(rawInput);
    } catch {
      return { status: "invalid-input", trace: finish("invalid-input") };
    }
    if (!projectionAllows(definition, input, context)) {
      return { status: "policy-denied", trace: finish("policy-denied") };
    }
    if (context.signal?.aborted) return { status: "aborted", trace: finish("aborted") };

    const controller = new AbortController();
    const interrupted = Symbol("ai-tool-interrupted");
    let interrupt: (reason: symbol) => void = () => undefined;
    let timedOut = false;
    const interruption = new Promise<never>((_resolve, reject) => {
      interrupt = reject;
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Tool timeout", "TimeoutError"));
      interrupt(interrupted);
    }, definition.timeoutMs);
    const abortFromCaller = () => {
      controller.abort(context.signal?.reason);
      interrupt(interrupted);
    };
    context.signal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      // Promise.race owns the wall-clock boundary even when a buggy handler ignores AbortSignal.
      // The race also installs a rejection handler on the execution promise, so a late rejection
      // after timeout cannot become an unhandled rejection.
      const execution = Promise.resolve().then(() =>
        definition.execute(input, {
          actor: context.actor,
          projection: context.projection,
          signal: controller.signal
        })
      );
      const rawOutput = await Promise.race([execution, interruption]);
      const responseBytes = encodedBytes(rawOutput);
      if (responseBytes > definition.maxResponseBytes) {
        return {
          status: "invalid-output",
          trace: finish("invalid-output", { responseBytes })
        };
      }
      let value: unknown;
      try {
        value = definition.parseOutput(rawOutput);
      } catch {
        return {
          status: "invalid-output",
          trace: finish("invalid-output", { responseBytes })
        };
      }
      return {
        status: "succeeded",
        value: value as Output,
        trace: finish("succeeded", { responseBytes })
      };
    } catch (error) {
      if (context.signal?.aborted) return { status: "aborted", trace: finish("aborted") };
      if (timedOut || error === interrupted) return { status: "timeout", trace: finish("timeout") };
      return { status: "tool-error", trace: finish("tool-error") };
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}
