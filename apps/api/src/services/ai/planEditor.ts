/**
 * The assistant's edits to an open plan, as proposals (§30.8).
 *
 * Nothing here writes on the model's word. An edit vocabulary — add, remove, move, rename — is
 * translated into one `PlanCommandV2` batch, dry-run through `AiPlanProposalStore`, and returned
 * as a diff. The plan changes only when the user confirms that diff, and one undo puts it back.
 *
 * The translation lives on the server for the same reason the inline layer does: a stop may only
 * be a place a tool actually returned, so an id the loop never saw cannot become a coordinate.
 */

import { randomUUID } from "node:crypto";
import type { PlanCommandV2, PlanDocumentV2, PlanStopV2 } from "@mapos/layer-sdk";
import type { AiCitation } from "./contracts.js";
import type { AiChatPlanEdit, AiChatPlanEditor } from "./chatService.js";
import type { AiPlaceSearchRecord } from "./placeSearch.js";
import { AiPlanProposalStore, type AiPlanCommandProposal } from "./planProposal.js";

/** Just enough of the plan repository to read one plan and store the confirmed result. */
export interface AiPlanEditorRepository {
  get(ownerUserId: string, planId: string): Promise<PlanDocumentV2 | null>;
  replace(
    ownerUserId: string,
    planId: string,
    plan: PlanDocumentV2,
    expectedRevision: number
  ): Promise<PlanDocumentV2>;
}

export class AiPlanProposalPlanMissingError extends Error {
  readonly name = "AiPlanProposalPlanMissingError";
}

const DEFAULT_DWELL_MINUTES = 45;

function stopFrom(
  place: AiPlaceSearchRecord,
  note: string | undefined,
  id: string
): Omit<PlanStopV2, "order"> {
  return {
    id,
    name: place.title.slice(0, 240),
    location: { type: "Point", coordinates: [place.longitude, place.latitude] },
    sourceFeatureId: place.id,
    dwellMinutes: DEFAULT_DWELL_MINUTES,
    status: "suggested",
    ...(note ? { notes: note.slice(0, 240) } : {})
  };
}

/**
 * Turns the chat's edit list into one batch command against the plan as it is now.
 *
 * Indices are resolved against the plan the user is looking at, and an edit that names a stop or
 * a place that does not exist is dropped rather than guessed. An empty result throws: proposing
 * "no change" as a change would be a lie the user has to click through.
 */
export function planCommandFromEdits(input: {
  plan: PlanDocumentV2;
  edits: readonly AiChatPlanEdit[];
  places: readonly AiPlaceSearchRecord[];
  createId?: () => string;
}): PlanCommandV2 {
  const createId = input.createId ?? (() => `ai-stop-${randomUUID().slice(0, 8)}`);
  const byPlaceId = new Map(input.places.map((place) => [place.id, place]));
  const stopIds = new Set(input.plan.stops.map((stop) => stop.id));
  const commands: PlanCommandV2[] = [];
  // Insertions move the tail, so the index an edit asked for is resolved against a running count.
  let stopCount = input.plan.stops.length;

  for (const edit of input.edits.slice(0, 20)) {
    if (edit.op === "add-stop") {
      const place = edit.placeId ? byPlaceId.get(edit.placeId) : undefined;
      if (!place) continue;
      const index = Math.min(Math.max(edit.atIndex ?? stopCount, 0), stopCount);
      commands.push({ type: "add-stop", stop: stopFrom(place, edit.note, createId()), index });
      stopCount += 1;
      continue;
    }
    if (edit.op === "remove-stop") {
      if (!edit.stopId || !stopIds.has(edit.stopId)) continue;
      commands.push({ type: "remove-stop", stopId: edit.stopId });
      stopIds.delete(edit.stopId);
      stopCount = Math.max(0, stopCount - 1);
      continue;
    }
    if (edit.op === "move-stop") {
      if (!edit.stopId || !stopIds.has(edit.stopId)) continue;
      const toIndex = Math.min(Math.max(edit.toIndex ?? 0, 0), Math.max(0, stopCount - 1));
      commands.push({ type: "move-stop", stopId: edit.stopId, toIndex });
      continue;
    }
    if (edit.op === "rename-plan" && edit.name) {
      commands.push({ type: "update-plan", patch: { name: edit.name.slice(0, 120) } });
    }
  }

  if (!commands.length) throw new Error("no edit in this proposal applies to the plan");
  return commands.length === 1 ? commands[0]! : { type: "batch", commands };
}

export interface AiPlanProposalCoordinator {
  editor: AiChatPlanEditor;
  get(ownerUserId: string, proposalId: string): AiPlanCommandProposal;
  confirm(
    ownerUserId: string,
    proposalId: string
  ): Promise<{ proposal: AiPlanCommandProposal; plan: PlanDocumentV2 }>;
  reject(ownerUserId: string, proposalId: string): AiPlanCommandProposal;
  undo(
    ownerUserId: string,
    proposalId: string
  ): Promise<{ proposal: AiPlanCommandProposal; plan: PlanDocumentV2 }>;
}

/**
 * One coordinator per deployment: the chat proposes through `editor`, the routes confirm, reject
 * and undo through the same store, so a proposal cannot be applied twice or applied by someone
 * who did not make it.
 */
export function createAiPlanProposalCoordinator(options: {
  repository: AiPlanEditorRepository;
  store?: AiPlanProposalStore;
  createStopId?: () => string;
  proposalTtlMs?: number;
}): AiPlanProposalCoordinator {
  const store = options.store ?? new AiPlanProposalStore();

  const load = async (ownerUserId: string, planId: string): Promise<PlanDocumentV2> => {
    const plan = await options.repository.get(ownerUserId, planId);
    if (!plan) throw new AiPlanProposalPlanMissingError("Plan is not available");
    return plan;
  };

  const persist = async (
    ownerUserId: string,
    applied: { proposal: AiPlanCommandProposal; plan: PlanDocumentV2 },
    expectedRevision: number
  ) => {
    const plan = await options.repository.replace(
      ownerUserId,
      applied.plan.id,
      applied.plan,
      expectedRevision
    );
    return { proposal: applied.proposal, plan };
  };

  return {
    editor: {
      async propose(input) {
        const plan = await load(input.ownerUserId, input.planId);
        const command = planCommandFromEdits({
          plan,
          edits: input.edits,
          places: input.places,
          ...(options.createStopId ? { createId: options.createStopId } : {})
        });
        const proposal = store.create({
          ownerUserId: input.ownerUserId,
          plan,
          command,
          summary: input.summary,
          conversationId: input.conversationId,
          citations: input.citations as readonly AiCitation[],
          ...(options.proposalTtlMs ? { ttlMs: options.proposalTtlMs } : {})
        });
        return { proposalId: proposal.id, planId: proposal.planId, diff: proposal.diff };
      }
    },

    get(ownerUserId, proposalId) {
      return store.get(ownerUserId, proposalId);
    },

    async confirm(ownerUserId, proposalId) {
      const proposal = store.get(ownerUserId, proposalId);
      const plan = await load(ownerUserId, proposal.planId);
      const applied = store.confirm(ownerUserId, proposalId, plan);
      return persist(ownerUserId, applied, plan.revision);
    },

    reject(ownerUserId, proposalId) {
      return store.reject(ownerUserId, proposalId);
    },

    async undo(ownerUserId, proposalId) {
      const proposal = store.get(ownerUserId, proposalId);
      const plan = await load(ownerUserId, proposal.planId);
      const restored = store.undo(ownerUserId, proposalId, plan);
      return persist(ownerUserId, restored, plan.revision);
    }
  };
}

export {
  AiPlanProposalNotFoundError,
  AiPlanProposalRevisionError,
  AiPlanProposalStateError
} from "./planProposal.js";
