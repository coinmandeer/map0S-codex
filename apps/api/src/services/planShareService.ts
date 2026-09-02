import { createHash, randomBytes } from "node:crypto";
import { assertPlanDocumentV2, type PlanDocumentV2 } from "@mapos/layer-sdk";

export const PLAN_SHARE_TOKEN_PATTERN = "^[A-Za-z0-9_-]{43}$";

export function hashPlanShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createPlanShareToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * A link grants read-only access to the itinerary, never to private notes, conversation history,
 * author identity or internal metadata. The returned document remains a valid PlanDocument v2.
 */
export function projectPlanForShare(plan: PlanDocumentV2): PlanDocumentV2 {
  assertPlanDocumentV2(plan);
  const projected: PlanDocumentV2 = {
    ...structuredClone(plan),
    ownerId: null,
    visibility: "unlisted",
    stops: plan.stops.map(({ notes: _notes, conversationId: _conversationId, ...stop }) => ({
      ...structuredClone(stop)
    })),
    segments: plan.segments.map(({ notes: _notes, ...segment }) => ({
      ...structuredClone(segment)
    })),
    annotations: [],
    conversationIds: [],
    metadata: { "dev.mapos.sharedReadOnly": true }
  };
  assertPlanDocumentV2(projected);
  return projected;
}
