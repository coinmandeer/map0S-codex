import { randomUUID } from "node:crypto";
import {
  PlanCommandError,
  applyPlanCommand,
  restorePlanSnapshot,
  type PlanCommandV2,
  type PlanDocumentV2
} from "@mapos/layer-sdk";
import type { AiCitation } from "./contracts.js";

export type AiPlanProposalStatus = "draft" | "confirmed" | "rejected" | "undone" | "expired";

export interface AiPlanDiff {
  baseRevision: number;
  previewRevision: number;
  changedPlanFields: string[];
  addedStopIds: string[];
  removedStopIds: string[];
  movedStopIds: string[];
  updatedStopIds: string[];
  affectedSegmentIds: string[];
}

export interface AiPlanCommandProposal {
  id: string;
  ownerUserId: string;
  planId: string;
  conversationId: string | null;
  baseRevision: number;
  command: PlanCommandV2;
  summary: string;
  citations: AiCitation[];
  diff: AiPlanDiff;
  status: AiPlanProposalStatus;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  appliedRevision: number | null;
}

export interface CreateAiPlanProposalInput {
  ownerUserId: string;
  plan: PlanDocumentV2;
  command: unknown;
  summary: string;
  conversationId?: string | null;
  citations?: readonly AiCitation[];
  ttlMs?: number;
}

export interface ConfirmedAiPlanProposal {
  proposal: AiPlanCommandProposal;
  plan: PlanDocumentV2;
}

export class AiPlanProposalNotFoundError extends Error {
  readonly name = "AiPlanProposalNotFoundError";
}

export class AiPlanProposalStateError extends Error {
  readonly name = "AiPlanProposalStateError";
}

export class AiPlanProposalRevisionError extends Error {
  readonly name = "AiPlanProposalRevisionError";
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_COMMAND_BYTES = 64 * 1024;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_TTL_MS = 60 * 60 * 1000;
const PLAN_DIFF_FIELDS = [
  "name",
  "description",
  "status",
  "visibility",
  "departureAt",
  "timezone",
  "vehicle",
  "routePolicy",
  "conversationIds",
  "activatedLayerIds",
  "annotations"
] as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanIdentifier(value: string, label: string): string {
  const clean = value.trim();
  if (!IDENTIFIER.test(clean)) throw new TypeError(`Invalid ${label}`);
  return clean;
}

function hasDisallowedTextControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // Preserve tab/newline/carriage-return for readable summaries, matching the prior contract.
    if (code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31)) return true;
  }
  return false;
}

function cleanSummary(value: string): string {
  const clean = value.trim();
  if (!clean || clean.length > 500 || hasDisallowedTextControl(clean)) {
    throw new TypeError("Invalid proposal summary");
  }
  return clean;
}

function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function cleanCitations(citations: readonly AiCitation[]): AiCitation[] {
  const seen = new Set<string>();
  const result: AiCitation[] = [];
  for (const citation of citations.slice(0, 20)) {
    const sourceId = cleanIdentifier(citation.sourceId, "citation source id");
    if (seen.has(sourceId)) continue;
    const label = citation.label.trim();
    if (!label || label.length > 240) throw new TypeError("Invalid citation label");
    let url: string | undefined;
    if (citation.url) {
      const parsed = new URL(citation.url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new TypeError("Invalid citation URL");
      }
      url = parsed.toString();
    }
    result.push({
      sourceId,
      label,
      ...(url ? { url } : {}),
      ...(citation.providerId
        ? { providerId: cleanIdentifier(citation.providerId, "citation provider id") }
        : {}),
      ...(citation.retrievedAt ? { retrievedAt: citation.retrievedAt } : {})
    });
    seen.add(sourceId);
  }
  return result;
}

function parseCommandJson(value: string): unknown {
  if (!value.trim() || Buffer.byteLength(value, "utf8") > MAX_COMMAND_BYTES) {
    throw new TypeError("Invalid AI plan command payload");
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new TypeError("Invalid AI plan command JSON");
  }
}

function changed(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function buildDiff(
  before: PlanDocumentV2,
  after: PlanDocumentV2,
  affectedSegmentIds: readonly string[]
): AiPlanDiff {
  const beforeById = new Map(before.stops.map((stop) => [stop.id, stop]));
  const afterById = new Map(after.stops.map((stop) => [stop.id, stop]));
  const addedStopIds = after.stops
    .filter((stop) => !beforeById.has(stop.id))
    .map((stop) => stop.id);
  const removedStopIds = before.stops
    .filter((stop) => !afterById.has(stop.id))
    .map((stop) => stop.id);
  const movedStopIds = after.stops
    .filter((stop) => beforeById.has(stop.id) && beforeById.get(stop.id)!.order !== stop.order)
    .map((stop) => stop.id);
  const updatedStopIds = after.stops
    .filter((stop) => {
      const previous = beforeById.get(stop.id);
      if (!previous) return false;
      const { order: _beforeOrder, ...beforeContent } = previous;
      const { order: _afterOrder, ...afterContent } = stop;
      return changed(beforeContent, afterContent);
    })
    .map((stop) => stop.id);

  return {
    baseRevision: before.revision,
    previewRevision: after.revision,
    changedPlanFields: PLAN_DIFF_FIELDS.filter((field) => changed(before[field], after[field])),
    addedStopIds,
    removedStopIds,
    movedStopIds,
    updatedStopIds,
    affectedSegmentIds: [...affectedSegmentIds]
  };
}

function planOwnedBy(plan: PlanDocumentV2, ownerUserId: string): void {
  if (plan.ownerId && plan.ownerId !== ownerUserId) {
    // Keep cross-owner access indistinguishable from an unknown proposal.
    throw new AiPlanProposalNotFoundError("Plan proposal not found");
  }
}

/**
 * Server-side confirmation boundary for model-authored plan commands. Creation only dry-runs a
 * shared PlanCommand; no model output can mutate a plan until the owner confirms the exact
 * revision. The caller persists the returned document through the normal plan repository.
 */
export class AiPlanProposalStore {
  private readonly proposals = new Map<string, AiPlanCommandProposal>();
  private readonly undoSnapshots = new Map<string, PlanDocumentV2>();

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID
  ) {}

  create(input: CreateAiPlanProposalInput): AiPlanCommandProposal {
    const ownerUserId = cleanIdentifier(input.ownerUserId, "owner id");
    planOwnedBy(input.plan, ownerUserId);
    const id = cleanIdentifier(this.createId(), "proposal id");
    const commandValue =
      typeof input.command === "string" ? parseCommandJson(input.command) : input.command;
    if (!record(commandValue) || jsonBytes(commandValue) > MAX_COMMAND_BYTES) {
      throw new TypeError("Invalid AI plan command payload");
    }

    const command = clone(commandValue) as PlanCommandV2;
    const preview = applyPlanCommand(input.plan, {
      id: `ai-preview:${id}`,
      expectedRevision: input.plan.revision,
      actorId: ownerUserId,
      command
    });
    const createdAt = this.now();
    if (Number.isNaN(createdAt.getTime())) throw new TypeError("Invalid proposal clock");
    const ttlMs = Math.min(MAX_TTL_MS, Math.max(1_000, input.ttlMs ?? DEFAULT_TTL_MS));
    const proposal: AiPlanCommandProposal = {
      id,
      ownerUserId,
      planId: input.plan.id,
      conversationId:
        input.conversationId == null
          ? null
          : cleanIdentifier(input.conversationId, "conversation id"),
      baseRevision: input.plan.revision,
      command,
      summary: cleanSummary(input.summary),
      citations: cleanCitations(input.citations ?? []),
      diff: buildDiff(input.plan, preview.plan, preview.revision.affectedSegmentIds),
      status: "draft",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
      confirmedAt: null,
      appliedRevision: null
    };
    this.proposals.set(id, proposal);
    return clone(proposal);
  }

  get(ownerUserId: string, proposalId: string): AiPlanCommandProposal {
    const proposal = this.owned(ownerUserId, proposalId);
    this.expire(proposal);
    return clone(proposal);
  }

  reject(ownerUserId: string, proposalId: string): AiPlanCommandProposal {
    const proposal = this.draft(ownerUserId, proposalId);
    proposal.status = "rejected";
    return clone(proposal);
  }

  confirm(
    ownerUserId: string,
    proposalId: string,
    currentPlan: PlanDocumentV2
  ): ConfirmedAiPlanProposal {
    const owner = cleanIdentifier(ownerUserId, "owner id");
    const proposal = this.draft(owner, proposalId);
    planOwnedBy(currentPlan, owner);
    if (currentPlan.id !== proposal.planId) {
      throw new AiPlanProposalNotFoundError("Plan proposal not found");
    }
    if (currentPlan.revision !== proposal.baseRevision) {
      throw new AiPlanProposalRevisionError(
        `Stale proposal revision ${proposal.baseRevision}; current revision is ${currentPlan.revision}`
      );
    }

    let applied;
    try {
      applied = applyPlanCommand(currentPlan, {
        id: `ai-confirm:${proposal.id}`,
        expectedRevision: proposal.baseRevision,
        actorId: owner,
        command: proposal.command
      });
    } catch (error) {
      if (error instanceof PlanCommandError && error.code === "REVISION_CONFLICT") {
        throw new AiPlanProposalRevisionError(error.message);
      }
      throw error;
    }
    proposal.status = "confirmed";
    proposal.confirmedAt = this.now().toISOString();
    proposal.appliedRevision = applied.plan.revision;
    this.undoSnapshots.set(proposal.id, clone(applied.undoDocument));
    return { proposal: clone(proposal), plan: applied.plan };
  }

  undo(
    ownerUserId: string,
    proposalId: string,
    currentPlan: PlanDocumentV2
  ): ConfirmedAiPlanProposal {
    const owner = cleanIdentifier(ownerUserId, "owner id");
    const proposal = this.owned(owner, proposalId);
    planOwnedBy(currentPlan, owner);
    if (proposal.status !== "confirmed" || !proposal.appliedRevision) {
      throw new AiPlanProposalStateError("Only a confirmed proposal can be undone");
    }
    if (currentPlan.id !== proposal.planId) {
      throw new AiPlanProposalNotFoundError("Plan proposal not found");
    }
    if (currentPlan.revision !== proposal.appliedRevision) {
      throw new AiPlanProposalRevisionError("The plan changed after this proposal was confirmed");
    }
    const snapshot = this.undoSnapshots.get(proposal.id);
    if (!snapshot) throw new AiPlanProposalStateError("Undo snapshot is unavailable");
    const plan = restorePlanSnapshot(currentPlan, snapshot, {
      now: () => this.now().toISOString()
    });
    proposal.status = "undone";
    this.undoSnapshots.delete(proposal.id);
    return { proposal: clone(proposal), plan };
  }

  private draft(ownerUserId: string, proposalId: string): AiPlanCommandProposal {
    const proposal = this.owned(ownerUserId, proposalId);
    this.expire(proposal);
    if (proposal.status !== "draft") {
      throw new AiPlanProposalStateError(`Proposal is ${proposal.status}`);
    }
    return proposal;
  }

  private expire(proposal: AiPlanCommandProposal): void {
    if (proposal.status === "draft" && this.now().getTime() >= Date.parse(proposal.expiresAt)) {
      proposal.status = "expired";
    }
  }

  private owned(ownerUserId: string, proposalId: string): AiPlanCommandProposal {
    const owner = cleanIdentifier(ownerUserId, "owner id");
    const proposal = this.proposals.get(cleanIdentifier(proposalId, "proposal id"));
    if (!proposal || proposal.ownerUserId !== owner) {
      throw new AiPlanProposalNotFoundError("Plan proposal not found");
    }
    return proposal;
  }
}
