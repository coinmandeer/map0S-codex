import { nanoid } from "nanoid";
import { assertPlanDocumentV2, type PlanDocumentV2 } from "@mapos/layer-sdk";
import { memoryDb } from "../db/memory.js";
import { ClientError } from "../utils/clientError.js";
import type { PlanDocumentRepository } from "./planDocumentRepository.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function persisted(document: PlanDocumentV2): PlanDocumentV2 {
  return {
    ...document,
    metadata: { ...(document.metadata ?? {}), "dev.mapos.persisted": true }
  };
}

export const memoryPlanDocumentRepository: PlanDocumentRepository = {
  async list(ownerId) {
    return memoryDb.planDocuments
      .filter((row) => row.userId === ownerId)
      .map((row) => clone(row.plan))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  },

  async get(ownerId, id) {
    const row = memoryDb.planDocuments.find(
      (candidate) => candidate.userId === ownerId && candidate.plan.id === id
    );
    return row ? clone(row.plan) : null;
  },

  async create(ownerId, input) {
    assertPlanDocumentV2(input);
    if (input.stops.length < 2) throw new ClientError("Před uložením plánu přidejte cíl", 400);
    const timestamp = new Date().toISOString();
    const plan = persisted({
      ...clone(input),
      id: `plan-${nanoid(12)}`,
      ownerId,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    assertPlanDocumentV2(plan);
    memoryDb.planDocuments.push({ userId: ownerId, plan: clone(plan) });
    return plan;
  },

  async replace(ownerId, id, input, expectedRevision) {
    assertPlanDocumentV2(input);
    if (input.stops.length < 2) throw new ClientError("Před uložením plánu přidejte cíl", 400);
    const row = memoryDb.planDocuments.find(
      (candidate) => candidate.userId === ownerId && candidate.plan.id === id
    );
    if (!row) throw new ClientError("Plán nebyl nalezen", 404);
    if (row.plan.revision !== expectedRevision) {
      throw new ClientError(`Plán se mezitím změnil (aktuální revize ${row.plan.revision})`, 409);
    }
    const plan = persisted({
      ...clone(input),
      id,
      ownerId,
      revision: Math.max(row.plan.revision + 1, input.revision),
      createdAt: row.plan.createdAt,
      updatedAt: new Date().toISOString()
    });
    assertPlanDocumentV2(plan);
    row.plan = clone(plan);
    return plan;
  },

  async delete(ownerId, id) {
    const index = memoryDb.planDocuments.findIndex(
      (candidate) => candidate.userId === ownerId && candidate.plan.id === id
    );
    if (index < 0) throw new ClientError("Plán nebyl nalezen", 404);
    memoryDb.planDocuments.splice(index, 1);
    for (let shareIndex = memoryDb.planShareLinks.length - 1; shareIndex >= 0; shareIndex -= 1) {
      const share = memoryDb.planShareLinks[shareIndex];
      if (share?.ownerId === ownerId && share.planId === id) {
        memoryDb.planShareLinks.splice(shareIndex, 1);
      }
    }
    for (
      let threadIndex = memoryDb.planDiscussionThreads.length - 1;
      threadIndex >= 0;
      threadIndex -= 1
    ) {
      const thread = memoryDb.planDiscussionThreads[threadIndex];
      if (thread?.ownerId === ownerId && thread.thread.planId === id) {
        memoryDb.planDiscussionThreads.splice(threadIndex, 1);
      }
    }
  }
};
