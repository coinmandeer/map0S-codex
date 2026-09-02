export const PLAN_DISCUSSION_MESSAGE_LIMIT = 40;

export interface PlanDiscussionMessage {
  id: string;
  revision: number;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  disclosure: string | null;
  createdAt: string;
}

export interface PlanDiscussionThread {
  id: string;
  planId: string;
  revision: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  messages: PlanDiscussionMessage[];
}

export interface AppendPlanDiscussionExchange {
  conversationId?: string;
  baseRevision?: number;
  prompt: string;
  answer: string;
  model: string;
  disclosure: string;
}

export interface PlanDiscussionRepository {
  latest(ownerId: string, planId: string): Promise<PlanDiscussionThread | null>;
  get(
    ownerId: string,
    planId: string,
    conversationId: string
  ): Promise<PlanDiscussionThread | null>;
  appendExchange(
    ownerId: string,
    planId: string,
    input: AppendPlanDiscussionExchange
  ): Promise<PlanDiscussionThread>;
}
