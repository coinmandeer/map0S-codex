import { randomUUID } from "node:crypto";
import type {
  ContactRequest,
  ContactView,
  GeoThread,
  PublicPresence,
  WorldMessage,
  WorldPage,
  WorldPosition
} from "@mapos/layer-sdk";
import { TROLLBOX_RADII } from "@mapos/layer-sdk";
import { ClientError } from "../utils/clientError.js";
import { GameWorld, point, record, text, type LivePlayer } from "./gameWorld.js";
import { distance, type WorldQuery } from "./repository.js";

interface Thread extends GeoThread {
  userId: string;
  hidden: boolean;
  actionId: string;
}
interface Message extends WorldMessage {
  userId: string;
  actionId: string;
}
const pair = (a: string, b: string) => [a, b].sort().join(":");
export class SocialWorld extends GameWorld {
  private relations = new Map<
    string,
    { until: number; known: Set<string>; blocked: Set<string> }
  >();
  private async relationships(userId: string) {
    const cached = this.relations.get(userId);
    if (cached && cached.until > this.now()) return cached;
    const [outgoing, incoming, blockedByMe, blockedMe] = await Promise.all([
      this.repository.list<ContactRequest>("contacts", {
        equals: { from: userId, status: "accepted" },
        limit: 10000
      }),
      this.repository.list<ContactRequest>("contacts", {
        equals: { to: userId, status: "accepted" },
        limit: 10000
      }),
      this.repository.list<{ otherId: string }>("blocks", { equals: { userId }, limit: 10000 }),
      this.repository.list<{ userId: string }>("blocks", {
        equals: { otherId: userId },
        limit: 10000
      })
    ]);
    const result = {
      until: this.now() + 5000,
      known: new Set([...outgoing, ...incoming].map((c) => (c.from === userId ? c.to : c.from))),
      blocked: new Set([...blockedByMe.map((b) => b.otherId), ...blockedMe.map((b) => b.userId)])
    };
    if (this.relations.size > 500) this.relations.clear();
    this.relations.set(userId, result);
    return result;
  }
  private async relationMutation<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } finally {
      this.relations.clear();
    }
  }

  private async blocked(a: string, b: string, tx = this.repository) {
    return !!((await tx.get("blocks", `${a}:${b}`)) || (await tx.get("blocks", `${b}:${a}`)));
  }
  private async accepted(a: string, b: string, tx = this.repository) {
    return (
      (await tx.list<ContactRequest>("contacts", { equals: { pairKey: pair(a, b) }, limit: 1 }))[0]
        ?.status === "accepted" && !(await this.blocked(a, b, tx))
    );
  }
  async setPresence(userId: string, sessionId: string, input: Record<string, unknown>) {
    const p = this.player(userId, sessionId);
    if (p.session.mode === "explore" && (input.visible || input.checkIn))
      throw new ClientError("Veřejná přítomnost a check-in vyžadují skutečnou GPS polohu", 403);
    if (typeof input.visible !== "boolean") throw new ClientError("Chybí stav dostupnosti");
    if (input.visible) this.ready(p);
    p.visible = input.visible;
    if (!p.visible) {
      p.checkIn = null;
      p.precise.clear();
      p.presenceId = randomUUID();
    }
    if (input.checkIn) {
      const check = input.checkIn as Record<string, unknown>;
      const at = point(check);
      if (distance(this.ready(p), at) > 150)
        throw new ClientError("Pro check-in musíš být u místa", 409);
      p.checkIn = { ...at, title: text(check.title, 100), expiresAt: this.now() + 3600000 };
    }
    return { visible: p.visible, checkIn: p.checkIn };
  }
  private approximate(at: WorldPosition): WorldPosition {
    // Stable geographic grid, independent of reader/query centre; never fresh random noise.
    const latStep = 150 / 111320;
    const lat = (Math.floor(at.lat / latStep) + 0.5) * latStep;
    const lngStep = 150 / (111320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    return { lat, lng: (Math.floor(at.lng / lngStep) + 0.5) * lngStep };
  }
  async nearby(userId: string, sessionId: string): Promise<PublicPresence[]> {
    const reader = this.player(userId, sessionId);
    const at = this.ready(reader),
      result: PublicPresence[] = [],
      relations = await this.relationships(userId);
    for (const p of this.players.values()) {
      if (
        p.userId === userId ||
        p.session.mode !== reader.session.mode ||
        !p.visible ||
        !p.position ||
        this.now() - p.positionAt > 30000 ||
        p.accuracy > 40 ||
        relations.blocked.has(p.userId)
      )
        continue;
      const coarse = this.approximate(p.position);
      // Admission also uses coarse position, preventing binary searches around a raw GPS fix.
      if (distance(this.approximate(at), coarse) > 1000) continue;
      const known = relations.known.has(p.userId);
      const precise = known && (p.precise.get(userId) ?? 0) > this.now();
      const profile = known ? await this.profile(p.userId) : null;
      const checkIn = p.checkIn && p.checkIn.expiresAt > this.now() ? p.checkIn : null;
      result.push({
        presenceId: p.presenceId,
        label: profile?.displayName ?? `Duch ${p.presenceId.slice(0, 4)}`,
        ...(checkIn ? { lng: checkIn.lng, lat: checkIn.lat } : precise ? p.position : coarse),
        approximate: !precise && !checkIn,
        ...(profile
          ? {
              profile,
              ...(p.session.avatarTokenId ? { avatarTokenId: p.session.avatarTokenId } : {})
            }
          : {}),
        ...(checkIn ? { checkIn: { title: checkIn.title, expiresAt: checkIn.expiresAt } } : {})
      });
      if (result.length === 100) break;
    }
    return result;
  }
  async sharePosition(userId: string, sessionId: string, otherId: string, enabled: boolean) {
    if (!(await this.accepted(userId, otherId)))
      throw new ClientError("Sdílení vyžaduje schválený kontakt", 403);
    const p = this.player(userId, sessionId);
    if (enabled) this.ready(p);
    p.precise.set(otherId, enabled ? this.now() + 15 * 60000 : 0);
    return { expiresAt: p.precise.get(otherId) };
  }
  async requestContact(
    userId: string,
    input: { presenceId?: string; userId?: string; sessionId?: string }
  ) {
    let target = input.userId;
    if (input.presenceId) {
      if (!input.sessionId) throw new ClientError("Chybí session");
      if (
        !(await this.nearby(userId, input.sessionId)).some((p) => p.presenceId === input.presenceId)
      )
        throw new ClientError("Hráč už není dostupný", 404);
      target = [...this.players.values()].find((p) => p.presenceId === input.presenceId)?.userId;
    }
    if (!target || target === userId || !(await this.profile(target)))
      throw new ClientError("Kontakt nebyl nalezen", 404);
    const other = target;
    return this.repository.transaction(async (tx) => {
      if (await this.blocked(userId, other, tx))
        throw new ClientError("Propojení není dostupné", 403);
      const pairKey = pair(userId, other),
        existing = (
          await tx.list<ContactRequest>("contacts", { equals: { pairKey }, limit: 1 })
        )[0];
      const id = existing?.id ?? randomUUID();
      if (existing?.status === "pending" || existing?.status === "accepted")
        return { id, status: existing.status };
      const request: ContactRequest = {
        id,
        from: userId,
        to: other,
        status: "pending",
        createdAt: this.stamp()
      };
      await tx.put("contacts", { ...record(request), pairKey });
      return { id, status: request.status };
    });
  }
  async respond(userId: string, id: string, accept: boolean) {
    return this.relationMutation(() =>
      this.repository.transaction(async (tx) => {
        const contact = await tx.get<ContactRequest>("contacts", id);
        if (!contact || contact.to !== userId || contact.status !== "pending")
          throw new ClientError("Žádost nebyla nalezena", 404);
        if (await this.blocked(contact.from, contact.to, tx))
          throw new ClientError("Propojení není dostupné", 403);
        contact.status = accept ? "accepted" : "declined";
        await tx.put("contacts", record(contact));
        if (accept)
          for (const owner of [contact.from, contact.to])
            await tx.put("favorites", { id: `${owner}:${id}`, userId: owner, contactId: id });
        return { ok: true };
      })
    );
  }
  async contacts(userId: string): Promise<ContactView[]> {
    const rows = [
      ...(await this.repository.list<ContactRequest>("contacts", {
        equals: { from: userId },
        limit: 100
      })),
      ...(await this.repository.list<ContactRequest>("contacts", {
        equals: { to: userId },
        limit: 100
      }))
    ];
    const result: ContactView[] = [];
    for (const c of rows) {
      if (c.status === "declined") continue;
      const other = c.from === userId ? c.to : c.from;
      if (await this.blocked(userId, other)) continue;
      // Outgoing pending requests to anonymous people must not reveal the recipient's identity.
      const reveal = c.status === "accepted" || c.to === userId;
      const profile = reveal ? await this.profile(other) : null;
      const read = await this.repository.get<{ at: number }>("reads", `${userId}:${c.id}`);
      const latest = await this.repository.list<Message>("messages", {
        equals: { threadId: c.id },
        limit: 50
      });
      const { pairKey: _pairKey, ...publicContact } = c as ContactRequest & { pairKey?: string };
      result.push({
        ...publicContact,
        from: c.from === userId ? userId : reveal ? c.from : "",
        to: c.to === userId ? userId : reveal ? c.to : "",
        profile: profile ?? { id: "", displayName: "Čeká na propojení" },
        incoming: c.to === userId,
        favorite: !!(await this.repository.get("favorites", `${userId}:${c.id}`)),
        unread: latest.filter((m) => m.userId !== userId && m.createdAt > (read?.at ?? 0)).length
      });
    }
    return result;
  }
  async favorite(userId: string, id: string, enabled: boolean) {
    await this.conversation(userId, id);
    if (enabled)
      await this.repository.put("favorites", { id: `${userId}:${id}`, userId, contactId: id });
    else await this.repository.remove("favorites", `${userId}:${id}`);
    return { ok: true };
  }
  async disconnect(userId: string, id: string) {
    const c = await this.conversation(userId, id);
    c.status = "declined";
    await this.repository.put("contacts", record(c));
    this.relations.clear();
    for (const p of this.players.values())
      if (p.userId === c.from || p.userId === c.to) p.precise.clear();
    return { ok: true };
  }
  async blockPresence(userId: string, sessionId: string, presenceId: string) {
    if (!(await this.nearby(userId, sessionId)).some((p) => p.presenceId === presenceId))
      throw new ClientError("Hráč už není dostupný", 404);
    const peer = [...this.players.values()].find((p) => p.presenceId === presenceId);
    if (!peer) throw new ClientError("Hráč už není dostupný", 404);
    return this.block(userId, peer.userId);
  }
  async block(userId: string, otherId: string) {
    if (userId === otherId) throw new ClientError("Neplatný kontakt");
    await this.repository.put("blocks", {
      id: `${userId}:${otherId}`,
      userId,
      otherId,
      createdAt: this.stamp()
    });
    this.relations.clear();
    for (const p of this.players.values())
      if (p.userId === userId || p.userId === otherId) p.precise.clear();
    return { ok: true };
  }
  private async conversation(userId: string, id: string, tx = this.repository) {
    const c = await tx.get<ContactRequest>("contacts", id);
    if (
      !c ||
      ![c.from, c.to].includes(userId) ||
      c.status !== "accepted" ||
      (await this.blocked(c.from, c.to, tx))
    )
      throw new ClientError("Konverzace není dostupná", 403);
    return c;
  }
  async privateMessages(
    userId: string,
    id: string,
    before?: number
  ): Promise<WorldPage<WorldMessage>> {
    await this.conversation(userId, id);
    const rows = await this.repository.list<Message>("messages", {
      equals: { threadId: id },
      before,
      limit: 51
    });
    return this.messagePage(rows);
  }
  private messagePage(rows: Message[]): WorldPage<WorldMessage> {
    return {
      items: rows.slice(0, 50).map(({ actionId: _a, userId: _u, ...m }) => m),
      nextCursor: rows.length > 50 ? String(rows[49]!.createdAt) : null
    };
  }
  async sendPrivate(userId: string, id: string, body: unknown, actionId: unknown) {
    const content = text(body, 4000),
      key = text(actionId, 100),
      author = await this.profile(userId);
    if (!author) throw new ClientError("Profil nebyl nalezen", 401);
    return this.repository.transaction(async (tx) => {
      await this.conversation(userId, id, tx);
      const messageId = `dm:${userId}:${key}`;
      const old = await tx.get<Message>("messages", messageId);
      if (old) {
        if (old.threadId !== id || old.body !== content)
          throw new ClientError("Identifikátor zprávy už byl použit", 409);
        return { id: old.id };
      }
      await tx.put(
        "messages",
        record({
          id: messageId,
          threadId: id,
          userId,
          author,
          body: content,
          actionId: key,
          createdAt: this.stamp()
        } as Message)
      );
      return { id: messageId };
    });
  }
  async markRead(userId: string, id: string) {
    await this.conversation(userId, id);
    await this.repository.put("reads", { id: `${userId}:${id}`, userId, at: this.now() });
    return { ok: true };
  }
  private origin(userId: string, at: WorldPosition, sessionId?: string): GeoThread["origin"] {
    if (!sessionId) return "unknown";
    let p: LivePlayer;
    try {
      p = this.player(userId, sessionId);
    } catch {
      return "unknown";
    }
    if (
      p.session.mode !== "gps" ||
      !p.position ||
      p.accuracy > 40 ||
      this.now() - p.positionAt > 30000
    )
      return "unknown";
    return distance(p.position, at) <= 150 ? "nearby" : "remote";
  }
  async createThread(userId: string, input: Record<string, unknown>) {
    const at = point(input),
      author = await this.profile(userId);
    if (!author) throw new ClientError("Profil nebyl nalezen", 401);
    const actionId = text(input.actionId, 100),
      id = `geo:${userId}:${actionId}`;
    if (input.kind !== "place" && input.kind !== "trollbox")
      throw new ClientError("Neplatný druh zprávy");
    const thread: Thread = {
      id,
      ...at,
      userId,
      author,
      title: text(input.title, 100),
      body: text(input.body),
      kind: input.kind,
      origin: this.origin(
        userId,
        at,
        typeof input.sessionId === "string" ? input.sessionId : undefined
      ),
      createdAt: this.stamp(),
      updatedAt: this.now(),
      closed: false,
      hidden: false,
      replies: 0,
      actionId,
      ...(typeof input.placeId === "string" ? { placeId: text(input.placeId, 200) } : {})
    };
    return this.repository.transaction(async (tx) => {
      const old = await tx.get<Thread>("threads", id);
      if (old) {
        if (old.body !== thread.body || old.lng !== thread.lng || old.lat !== thread.lat)
          throw new ClientError("Identifikátor zprávy už byl použit", 409);
        return this.publicThread(old);
      }
      await tx.put("threads", record(thread));
      return this.publicThread(thread);
    });
  }
  private publicThread({ userId: _u, hidden: _h, actionId: _a, ...t }: Thread): GeoThread {
    return t;
  }
  async threads(userId: string, input: Record<string, unknown>): Promise<WorldPage<GeoThread>> {
    const query: WorldQuery = { equals: { hidden: false }, limit: 51 };
    if (input.mine === true) query.equals!.userId = userId;
    else if (Array.isArray(input.bbox) && input.bbox.length === 4) {
      const [w, s, e, n] = input.bbox.map(Number) as [number, number, number, number];
      point({ lng: w, lat: s });
      point({ lng: e, lat: n });
      if (w > e || s > n) throw new ClientError("Neplatný výřez");
      query.bbox = [w, s, e, n];
    } else {
      const at = point(input),
        radius = Number(input.radius ?? 500);
      if (!(TROLLBOX_RADII as readonly number[]).includes(radius))
        throw new ClientError("Neplatný okruh");
      query.area = { ...at, radius };
    }
    if (input.before !== undefined) {
      const before = Number(input.before);
      if (!Number.isFinite(before)) throw new ClientError("Neplatný kurzor");
      query.before = before;
    }
    const rows = await this.repository.list<Thread>("threads", query);
    return {
      items: rows.slice(0, 50).map((t) => this.publicThread(t)),
      nextCursor: rows.length > 50 ? String(rows[49]!.createdAt) : null
    };
  }
  async thread(id: string) {
    const thread = await this.repository.get<Thread>("threads", id);
    if (!thread || thread.hidden) throw new ClientError("Zpráva nebyla nalezena", 404);
    return this.publicThread(thread);
  }
  async editThread(userId: string, id: string, input: Record<string, unknown>) {
    return this.repository.transaction(async (tx) => {
      const t = await tx.get<Thread>("threads", id);
      if (!t || t.userId !== userId) throw new ClientError("Zpráva nebyla nalezena", 404);
      if (input.body !== undefined) t.body = text(input.body);
      if (input.closed !== undefined) t.closed = input.closed === true;
      if (input.hidden !== undefined) t.hidden = input.hidden === true;
      t.updatedAt = this.now();
      await tx.put("threads", record(t));
      return { ok: true };
    });
  }
  async replies(id: string, before?: number) {
    await this.thread(id);
    return this.messagePage(
      await this.repository.list<Message>("messages", {
        equals: { threadId: id },
        before,
        limit: 51
      })
    );
  }
  async reply(userId: string, id: string, body: unknown, actionId: unknown) {
    const content = text(body),
      key = text(actionId, 100),
      author = await this.profile(userId);
    if (!author) throw new ClientError("Profil nebyl nalezen", 401);
    return this.repository.transaction(async (tx) => {
      const thread = await tx.get<Thread>("threads", id);
      if (!thread || thread.closed || thread.hidden)
        throw new ClientError("Vlákno je uzavřené", 409);
      if (await this.blocked(userId, thread.userId, tx))
        throw new ClientError("Vlákno není dostupné", 403);
      const mid = `reply:${userId}:${key}`,
        old = await tx.get<Message>("messages", mid);
      if (old) {
        if (old.threadId !== id || old.body !== content)
          throw new ClientError("Identifikátor zprávy už byl použit", 409);
        return { id: old.id };
      }
      await tx.put(
        "messages",
        record({
          id: mid,
          threadId: id,
          userId,
          author,
          body: content,
          createdAt: this.stamp(),
          actionId: key
        } as Message)
      );
      thread.replies++;
      thread.updatedAt = this.now();
      await tx.put("threads", record(thread));
      return { id: mid };
    });
  }
  async report(userId: string, id: string, reason: unknown) {
    await this.thread(id);
    await this.repository.put("reports", {
      id: `${userId}:${id}`,
      userId,
      threadId: id,
      reason: text(reason, 500),
      createdAt: this.stamp()
    });
    return { ok: true };
  }
  async moderate(id: string) {
    const t = await this.repository.get<Thread>("threads", id);
    if (!t) throw new ClientError("Zpráva nebyla nalezena", 404);
    t.hidden = true;
    await this.repository.put("threads", record(t));
    return { ok: true };
  }
  async eraseUser(userId: string) {
    await this.serialize(() =>
      this.repository.transaction(async (tx) => {
        const purge = async (
          table: import("./repository.js").WorldTable,
          key: string,
          value: string
        ) => {
          while (true) {
            const rows = await tx.list<{ id: string }>(table, {
              equals: { [key]: value },
              limit: 500
            });
            if (!rows.length) break;
            for (const row of rows) await tx.remove(table, row.id);
          }
        };
        for (const key of ["from", "to"])
          while (true) {
            const contacts = await tx.list<ContactRequest>("contacts", {
              equals: { [key]: userId },
              limit: 100
            });
            if (!contacts.length) break;
            for (const c of contacts) {
              await purge("messages", "threadId", c.id);
              await purge("favorites", "contactId", c.id);
              await tx.remove("contacts", c.id);
            }
          }
        while (true) {
          const threads = await tx.list<Thread>("threads", { equals: { userId }, limit: 100 });
          if (!threads.length) break;
          for (const thread of threads) {
            await purge("messages", "threadId", thread.id);
            await purge("reports", "threadId", thread.id);
            await tx.remove("threads", thread.id);
          }
        }
        for (const table of [
          "profiles",
          "rewards",
          "blocks",
          "favorites",
          "messages",
          "reads",
          "quests",
          "reports",
          "actions"
        ] as const)
          await purge(table, table === "quests" ? "ownerId" : "userId", userId);
        await purge("blocks", "otherId", userId);
      })
    );
    this.relations.clear();
    for (const [key, p] of this.players) {
      if (p.userId === userId) this.players.delete(key);
      else p.precise.delete(userId);
    }
  }
  async exportUser(userId: string) {
    const contacts = await this.contacts(userId),
      conversations: Record<string, unknown> = {};
    for (const c of contacts.filter((c) => c.status === "accepted")) {
      const all: WorldMessage[] = [];
      let before: number | undefined;
      do {
        const page = await this.privateMessages(userId, c.id, before);
        all.push(...page.items);
        before = page.nextCursor ? Number(page.nextCursor) : undefined;
      } while (before !== undefined);
      conversations[c.id] = all;
    }
    const owned: Record<string, unknown> = {};
    for (const table of ["profiles", "rewards", "quests", "threads"] as const)
      owned[table] = await this.repository.list(table, {
        equals: { [table === "quests" ? "ownerId" : "userId"]: userId },
        limit: 100000
      });
    return { ...owned, contacts, conversations };
  }
}
