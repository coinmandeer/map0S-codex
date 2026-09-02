import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { planDiscussionThreads } from "../db/schema.js";
import { ClientError } from "../utils/clientError.js";
import type {
  AppendPlanDiscussionExchange,
  PlanDiscussionMessage,
  PlanDiscussionRepository,
  PlanDiscussionThread
} from "./planDiscussionRepository.js";
import { PLAN_DISCUSSION_MESSAGE_LIMIT } from "./planDiscussionRepository.js";

function publicThread(row: typeof planDiscussionThreads.$inferSelect): PlanDiscussionThread {
  return {
    id: row.id,
    planId: row.planId,
    revision: row.revision,
    messageCount: row.messageCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messages: structuredClone(row.messages)
  };
}

function exchangeMessages(
  revision: number,
  input: AppendPlanDiscussionExchange,
  createdAt: string
): PlanDiscussionMessage[] {
  return [
    {
      id: randomUUID(),
      revision: revision + 1,
      role: "user",
      content: input.prompt,
      model: null,
      disclosure: null,
      createdAt
    },
    {
      id: randomUUID(),
      revision: revision + 2,
      role: "assistant",
      content: input.answer,
      model: input.model,
      disclosure: input.disclosure,
      createdAt
    }
  ];
}

export const postgresPlanDiscussionRepository: PlanDiscussionRepository = {
  async latest(ownerId, planId) {
    const [row] = await db
      .select()
      .from(planDiscussionThreads)
      .where(
        and(
          eq(planDiscussionThreads.ownerUserId, ownerId),
          eq(planDiscussionThreads.planId, planId)
        )
      )
      .orderBy(desc(planDiscussionThreads.updatedAt))
      .limit(1);
    return row ? publicThread(row) : null;
  },

  async get(ownerId, planId, conversationId) {
    const [row] = await db
      .select()
      .from(planDiscussionThreads)
      .where(
        and(
          eq(planDiscussionThreads.id, conversationId),
          eq(planDiscussionThreads.ownerUserId, ownerId),
          eq(planDiscussionThreads.planId, planId)
        )
      )
      .limit(1);
    return row ? publicThread(row) : null;
  },

  async appendExchange(ownerId, planId, input) {
    return db.transaction(async (tx) => {
      const timestamp = new Date();
      const timestampIso = timestamp.toISOString();
      if (!input.conversationId) {
        const [created] = await tx
          .insert(planDiscussionThreads)
          .values({
            ownerUserId: ownerId,
            planId,
            revision: 2,
            messageCount: 2,
            messages: exchangeMessages(0, input, timestampIso),
            createdAt: timestamp,
            updatedAt: timestamp
          })
          .returning();
        if (!created) throw new Error("Plan discussion was not created");
        return publicThread(created);
      }

      const [current] = await tx
        .select()
        .from(planDiscussionThreads)
        .where(
          and(
            eq(planDiscussionThreads.id, input.conversationId),
            eq(planDiscussionThreads.ownerUserId, ownerId),
            eq(planDiscussionThreads.planId, planId)
          )
        )
        .limit(1)
        .for("update");
      if (!current) throw new ClientError("AI konverzace nebyla nalezena", 404);
      if (input.baseRevision !== current.revision) {
        throw new ClientError("AI konverzace se mezitím změnila", 409);
      }
      if (current.messageCount + 2 > PLAN_DISCUSSION_MESSAGE_LIMIT) {
        throw new ClientError("Tato konverzace je plná; založ novou", 409);
      }
      const [updated] = await tx
        .update(planDiscussionThreads)
        .set({
          revision: current.revision + 2,
          messageCount: current.messageCount + 2,
          messages: [
            ...current.messages,
            ...exchangeMessages(current.revision, input, timestampIso)
          ],
          updatedAt: timestamp
        })
        .where(eq(planDiscussionThreads.id, current.id))
        .returning();
      if (!updated) throw new Error("Plan discussion was not updated");
      return publicThread(updated);
    });
  }
};
