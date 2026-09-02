import { nanoid } from "nanoid";
import { memoryDb } from "../db/memory.js";
import { ClientError } from "../utils/clientError.js";
import type {
  AppendPlanDiscussionExchange,
  PlanDiscussionMessage,
  PlanDiscussionRepository,
  PlanDiscussionThread
} from "./planDiscussionRepository.js";
import { PLAN_DISCUSSION_MESSAGE_LIMIT } from "./planDiscussionRepository.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function appendMessages(
  revision: number,
  input: AppendPlanDiscussionExchange,
  createdAt: string
): PlanDiscussionMessage[] {
  return [
    {
      id: `message-${nanoid(12)}`,
      revision: revision + 1,
      role: "user",
      content: input.prompt,
      model: null,
      disclosure: null,
      createdAt
    },
    {
      id: `message-${nanoid(12)}`,
      revision: revision + 2,
      role: "assistant",
      content: input.answer,
      model: input.model,
      disclosure: input.disclosure,
      createdAt
    }
  ];
}

export const memoryPlanDiscussionRepository: PlanDiscussionRepository = {
  async latest(ownerId, planId) {
    const row = memoryDb.planDiscussionThreads
      .filter((candidate) => candidate.ownerId === ownerId && candidate.thread.planId === planId)
      .sort((left, right) => right.thread.updatedAt.localeCompare(left.thread.updatedAt))[0];
    return row ? clone(row.thread) : null;
  },

  async get(ownerId, planId, conversationId) {
    const row = memoryDb.planDiscussionThreads.find(
      (candidate) =>
        candidate.ownerId === ownerId &&
        candidate.thread.planId === planId &&
        candidate.thread.id === conversationId
    );
    return row ? clone(row.thread) : null;
  },

  async appendExchange(ownerId, planId, input) {
    const timestamp = new Date().toISOString();
    if (!input.conversationId) {
      const messages = appendMessages(0, input, timestamp);
      const thread: PlanDiscussionThread = {
        id: `conversation-${nanoid(12)}`,
        planId,
        revision: 2,
        messageCount: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
        messages
      };
      memoryDb.planDiscussionThreads.push({ ownerId, thread: clone(thread) });
      return thread;
    }
    const row = memoryDb.planDiscussionThreads.find(
      (candidate) =>
        candidate.ownerId === ownerId &&
        candidate.thread.planId === planId &&
        candidate.thread.id === input.conversationId
    );
    if (!row) throw new ClientError("AI konverzace nebyla nalezena", 404);
    if (input.baseRevision !== row.thread.revision) {
      throw new ClientError("AI konverzace se mezitím změnila", 409);
    }
    if (row.thread.messageCount + 2 > PLAN_DISCUSSION_MESSAGE_LIMIT) {
      throw new ClientError("Tato konverzace je plná; založ novou", 409);
    }
    const messages = appendMessages(row.thread.revision, input, timestamp);
    row.thread = {
      ...row.thread,
      revision: row.thread.revision + 2,
      messageCount: row.thread.messageCount + 2,
      updatedAt: timestamp,
      messages: [...row.thread.messages, ...messages]
    };
    return clone(row.thread);
  }
};
