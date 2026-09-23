import type { AiConversation } from "./conversation.js";
import { ConversationNotFoundError, ConversationRevisionError } from "./conversation.js";
import { sql } from "../../db/index.js";
export interface ConversationPersistence {
  load(owner: string, id: string): Promise<AiConversation>;
  save(document: AiConversation, expectedRevision: number | null): Promise<void>;
}
export const postgresConversationPersistence: ConversationPersistence = {
  async load(owner, id) {
    const rows =
      await sql`SELECT document FROM ai_conversations WHERE id=${id} AND owner_user_id=${owner} LIMIT 1`;
    if (!rows[0]) throw new ConversationNotFoundError("Conversation not found");
    return rows[0].document as AiConversation;
  },
  async save(document, expectedRevision) {
    const payload = JSON.stringify(document);
    if (Buffer.byteLength(payload) > 256 * 1024)
      throw new ConversationRevisionError("Conversation too large");
    const rows =
      expectedRevision === null
        ? await sql`
      INSERT INTO ai_conversations (id,owner_user_id,revision,document)
      VALUES (${document.id},${document.ownerUserId},${document.revision},${payload}::jsonb)
      ON CONFLICT (id) DO NOTHING RETURNING id`
        : await sql`
      UPDATE ai_conversations SET revision=${document.revision}, document=${payload}::jsonb, updated_at=NOW()
      WHERE id=${document.id} AND owner_user_id=${document.ownerUserId} AND revision=${expectedRevision} RETURNING id`;
    if (rows.length !== 1) throw new ConversationRevisionError("Conversation changed");
  }
};
