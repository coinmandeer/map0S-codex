import { legacyHistoryTurns } from "./legacyHistory.js";
import type { AiConversation } from "./conversation.js";
import { sql } from "../../db/index.js";
import type { AiChatAnswer } from "./chatService.js";
export interface HistoryTurn {
  id: string;
  question: string;
  requestedAt: string;
  text: string;
  cards: AiChatAnswer["cards"];
  sources: AiChatAnswer["sources"];
  followUps: string[];
  done: boolean;
  error: string | null;
  step: string | null;
  scopeKey: string;
  scopeLabel: string;
}
export interface ChatHistory {
  id: string;
  owner: string;
  title: string;
  revision: number;
  turns: HistoryTurn[];
  workspace: Record<string, unknown> | null;
  archived: boolean;
  updatedAt: string;
}
export interface ChatHistoryRepository {
  unavailable(owner: string, id: string): Promise<boolean>;
  list(owner: string, offset: number, includeArchived?: boolean): Promise<ChatHistory[]>;
  get(owner: string, id: string): Promise<ChatHistory | null>;
  turn(owner: string, id: string, revision: number, turn: HistoryTurn): Promise<void>;
  patch(
    owner: string,
    id: string,
    patch: {
      title?: string;
      archived?: boolean;
      workspace?: Record<string, unknown> | null;
      baseRevision?: number;
    }
  ): Promise<boolean>;
  delete(owner: string, id: string): Promise<boolean>;
}
interface HistoryRow {
  id: string;
  owner_user_id: string;
  title: string;
  revision: number;
  turns: HistoryTurn[];
  workspace: Record<string, unknown> | null;
  archived: boolean;
  updated_at: string | Date;
}
const mapRow = (row: Record<string, unknown>): ChatHistory => {
  const r = row as unknown as HistoryRow;
  return {
    id: r.id,
    owner: r.owner_user_id,
    title: r.title,
    revision: r.revision,
    turns: r.turns,
    workspace: r.workspace,
    archived: r.archived,
    updatedAt: new Date(r.updated_at).toISOString()
  };
};
export const postgresChatHistory: ChatHistoryRepository = {
  async unavailable(owner, id) {
    const rows =
      await sql`SELECT id FROM ai_chat_history WHERE owner_user_id=${owner} AND id=${id} AND (deleted OR archived)`;
    return rows.length > 0;
  },
  async list(owner, offset, includeArchived = false) {
    return (
      await sql`SELECT id,owner_user_id,title,revision,'[]'::jsonb AS turns,NULL AS workspace,archived,updated_at FROM ai_chat_history WHERE owner_user_id=${owner} AND (${includeArchived} OR NOT archived) AND NOT deleted ORDER BY updated_at DESC,id LIMIT 30 OFFSET ${offset}`
    ).map(mapRow);
  },
  async get(owner, id) {
    const rows =
      await sql`SELECT * FROM ai_chat_history WHERE id=${id} AND owner_user_id=${owner} AND NOT deleted`;
    if (!rows[0]) return null;
    const row = mapRow(rows[0]);
    if (!row.turns.length) {
      const old =
        await sql`SELECT document FROM ai_conversations WHERE id=${id} AND owner_user_id=${owner}`;
      if (old[0]) {
        const turns = legacyHistoryTurns(old[0].document as AiConversation);
        const migrated = await sql`UPDATE ai_chat_history SET turns=${JSON.stringify(turns)}::jsonb,
          title=${(turns.find((t) => t.scopeLabel === "Převedená starší historie" && !t.id.startsWith("legacy-note:"))?.question || row.title).slice(0, 120)}
          WHERE id=${id} AND owner_user_id=${owner} AND NOT deleted AND turns='[]'::jsonb AND revision=${row.revision} RETURNING *`;
        if (migrated[0]) return mapRow(migrated[0]);
      }
    }
    return row;
  },
  async turn(owner, id, revision, turn) {
    const payload = JSON.stringify(turn);
    await sql`INSERT INTO ai_chat_history (id,owner_user_id,title,revision,turns)
      VALUES (${id},${owner},${turn.question.slice(0, 120)},${revision},jsonb_build_array(${payload}::jsonb))
      ON CONFLICT (id) DO UPDATE SET revision=GREATEST(ai_chat_history.revision,EXCLUDED.revision),
      turns=(SELECT COALESCE(jsonb_agg(t),'[]'::jsonb) FROM jsonb_array_elements(ai_chat_history.turns) t WHERE t->>'id'<>${turn.id}) || jsonb_build_array(${payload}::jsonb),updated_at=NOW()
      WHERE ai_chat_history.owner_user_id=${owner} AND NOT ai_chat_history.deleted`;
  },
  async patch(owner, id, patch) {
    const rows =
      await sql`UPDATE ai_chat_history SET title=COALESCE(${patch.title ?? null},title),archived=COALESCE(${patch.archived ?? null},archived), workspace=CASE WHEN ${Object.hasOwn(patch, "workspace")} THEN ${JSON.stringify(patch.workspace ?? null)}::jsonb ELSE workspace END,updated_at=NOW() WHERE id=${id} AND owner_user_id=${owner} AND NOT deleted AND (${patch.baseRevision ?? null}::integer IS NULL OR revision=${patch.baseRevision ?? null}) RETURNING id`;
    return rows.length === 1;
  },
  async delete(owner, id) {
    return sql.begin(async (tx) => {
      const rows =
        await tx`UPDATE ai_chat_history SET deleted=TRUE,title='',turns='[]'::jsonb,workspace=NULL WHERE id=${id} AND owner_user_id=${owner} AND NOT deleted RETURNING id`;
      if (rows.length) {
        await tx`UPDATE ai_chat_requests SET response=NULL,fingerprint='' WHERE owner_user_id=${owner} AND conversation_id=${id}`;
        await tx`DELETE FROM ai_conversations WHERE id=${id} AND owner_user_id=${owner}`;
        await tx`DELETE FROM ai_map_artifacts WHERE conversation_id=${id} AND owner_user_id=${owner}`;
      }
      return rows.length === 1;
    });
  }
};
export function memoryChatHistory(): ChatHistoryRepository {
  const rows = new Map<string, ChatHistory>();
  const deleted = new Map<string, string>();
  const get = (owner: string, id: string) => (rows.get(id)?.owner === owner ? rows.get(id)! : null);
  return {
    async unavailable(owner, id) {
      return deleted.get(id) === owner || get(owner, id)?.archived === true;
    },
    async list(owner, offset, includeArchived = false) {
      return structuredClone(
        [...rows.values()]
          .filter((r) => r.owner === owner && (includeArchived || !r.archived))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(offset, offset + 30)
      );
    },
    async get(owner, id) {
      return structuredClone(get(owner, id));
    },
    async turn(owner, id, revision, turn) {
      if (deleted.has(id)) return;
      const old = get(owner, id);
      if (rows.has(id) && !old) return;
      rows.set(id, {
        id,
        owner,
        title: old?.title ?? turn.question.slice(0, 120),
        revision,
        turns: [...(old?.turns ?? []).filter((t) => t.id !== turn.id), structuredClone(turn)],
        workspace: old?.workspace ?? null,
        archived: old?.archived ?? false,
        updatedAt: new Date().toISOString()
      });
    },
    async patch(owner, id, patch) {
      const row = get(owner, id);
      if (!row || (patch.baseRevision !== undefined && row.revision !== patch.baseRevision))
        return false;
      const { baseRevision: _, ...values } = patch;
      Object.assign(row, structuredClone(values), { updatedAt: new Date().toISOString() });
      return true;
    },
    async delete(owner, id) {
      if (!get(owner, id)) return false;
      deleted.set(id, owner);
      return rows.delete(id);
    }
  };
}
