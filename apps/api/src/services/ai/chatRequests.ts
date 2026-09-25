import { sql } from "../../db/index.js";
import type { AiChatEvent } from "./chatService.js";
export type CompletedChat = Extract<AiChatEvent, { type: "done" | "error" }>;
export type ChatRequestClaim =
  | { status: "new" }
  | { status: "busy" | "conflict" | "gone" }
  | { status: "replay"; event: CompletedChat };
export interface ChatRequestRepository {
  claim(owner: string, id: string, fingerprint: string): Promise<ChatRequestClaim>;
  attach(owner: string, id: string, conversation: string): Promise<void>;
  finish(owner: string, id: string, event: CompletedChat): Promise<void>;
}
/** One database primary key admits a request across workers before any model/provider call. */
export const postgresChatRequests: ChatRequestRepository = {
  async claim(owner, id, fingerprint) {
    const inserted = await sql`INSERT INTO ai_chat_requests(owner_user_id,id,fingerprint)
      VALUES(${owner},${id},${fingerprint}) ON CONFLICT DO NOTHING RETURNING id`;
    if (inserted.length) return { status: "new" };
    const rows =
      await sql`SELECT r.fingerprint,r.response,h.deleted,h.archived FROM ai_chat_requests r
      LEFT JOIN ai_chat_history h ON h.id=r.conversation_id AND h.owner_user_id=r.owner_user_id
      WHERE r.owner_user_id=${owner} AND r.id=${id}`;
    const row = rows[0];
    if (!row || row.deleted || row.archived) return { status: "gone" };
    if (row.fingerprint !== fingerprint) return { status: "conflict" };
    return row.response
      ? { status: "replay", event: row.response as CompletedChat }
      : { status: "busy" };
  },
  async attach(owner, id, conversation) {
    await sql`UPDATE ai_chat_requests SET conversation_id=${conversation}
      WHERE owner_user_id=${owner} AND id=${id}
      AND EXISTS(SELECT 1 FROM ai_chat_history WHERE id=${conversation} AND owner_user_id=${owner} AND NOT deleted)`;
  },
  async finish(owner, id, event) {
    await sql.begin(async (tx) => {
      const rows =
        await tx`SELECT conversation_id FROM ai_chat_requests WHERE owner_user_id=${owner} AND id=${id}`;
      const conversation = rows[0]?.conversation_id;
      if (!conversation) return;
      // Same parent-first lock order as deletion and artifact persistence.
      const parent = await tx`SELECT id FROM ai_chat_history WHERE id=${conversation}
        AND owner_user_id=${owner} AND NOT deleted AND NOT archived FOR UPDATE`;
      if (!parent.length) return;
      await tx`UPDATE ai_chat_requests SET response=${JSON.stringify(event)}::jsonb
        WHERE owner_user_id=${owner} AND id=${id} AND response IS NULL`;
    });
  }
};
export function memoryChatRequests(): ChatRequestRepository {
  const rows = new Map<string, { fingerprint: string; event?: CompletedChat }>();
  return {
    async claim(owner, id, fingerprint) {
      const key = `${owner}:${id}`,
        row = rows.get(key);
      if (!row) {
        rows.set(key, { fingerprint });
        return { status: "new" };
      }
      if (row.fingerprint !== fingerprint) return { status: "conflict" };
      return row.event
        ? { status: "replay", event: structuredClone(row.event) }
        : { status: "busy" };
    },
    async attach() {},
    async finish(owner, id, event) {
      const row = rows.get(`${owner}:${id}`);
      if (row && !row.event) row.event = structuredClone(event);
    }
  };
}
