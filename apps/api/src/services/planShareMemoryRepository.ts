import { nanoid } from "nanoid";
import { memoryDb } from "../db/memory.js";
import { ClientError } from "../utils/clientError.js";
import type {
  PlanShareLink,
  PlanSharePermission,
  PlanShareRepository
} from "./planShareRepository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function publicLink(row: (typeof memoryDb.planShareLinks)[number]): PlanShareLink {
  const { tokenHash: _tokenHash, ownerId: _ownerId, ...link } = row;
  return clone(link);
}

export const memoryPlanShareRepository: PlanShareRepository = {
  async list(ownerId, planId) {
    return memoryDb.planShareLinks
      .filter((row) => row.ownerId === ownerId && row.planId === planId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(publicLink);
  },

  async create(ownerId, planId, tokenHash, permission: PlanSharePermission) {
    const row = {
      id: `share-${nanoid(12)}`,
      ownerId,
      planId,
      tokenHash,
      permission,
      createdAt: new Date().toISOString(),
      revokedAt: null
    };
    memoryDb.planShareLinks.push(row);
    return publicLink(row);
  },

  async resolve(tokenHash) {
    const link = memoryDb.planShareLinks.find(
      (row) => row.tokenHash === tokenHash && row.revokedAt === null
    );
    if (!link) return null;
    const plan = memoryDb.planDocuments.find(
      (row) => row.userId === link.ownerId && row.plan.id === link.planId
    )?.plan;
    return plan ? { share: publicLink(link), plan: clone(plan) } : null;
  },

  async revoke(ownerId, planId, shareId) {
    const link = memoryDb.planShareLinks.find(
      (row) => row.id === shareId && row.ownerId === ownerId && row.planId === planId
    );
    if (!link) throw new ClientError("Odkaz nebyl nalezen", 404);
    if (!link.revokedAt) link.revokedAt = new Date().toISOString();
  }
};
