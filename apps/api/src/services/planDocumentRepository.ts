import type { PlanDocumentV2 } from "@mapos/layer-sdk";

export interface PlanDocumentRepository {
  list(ownerId: string): Promise<PlanDocumentV2[]>;
  get(ownerId: string, id: string): Promise<PlanDocumentV2 | null>;
  create(ownerId: string, document: PlanDocumentV2): Promise<PlanDocumentV2>;
  replace(
    ownerId: string,
    id: string,
    document: PlanDocumentV2,
    expectedRevision: number
  ): Promise<PlanDocumentV2>;
  delete(ownerId: string, id: string): Promise<void>;
}
