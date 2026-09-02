import type { PlanDocumentV2 } from "@mapos/layer-sdk";

export type PlanSharePermission = "view";

export interface PlanShareLink {
  id: string;
  planId: string;
  permission: PlanSharePermission;
  createdAt: string;
  revokedAt: string | null;
}

export interface ResolvedPlanShare {
  share: PlanShareLink;
  plan: PlanDocumentV2;
}

export interface PlanShareRepository {
  list(ownerId: string, planId: string): Promise<PlanShareLink[]>;
  create(
    ownerId: string,
    planId: string,
    tokenHash: string,
    permission: PlanSharePermission
  ): Promise<PlanShareLink>;
  resolve(tokenHash: string): Promise<ResolvedPlanShare | null>;
  revoke(ownerId: string, planId: string, shareId: string): Promise<void>;
}
