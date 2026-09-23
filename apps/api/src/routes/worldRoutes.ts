import websocket from "@fastify/websocket";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { GeoThread, GameAction, WorldProfile } from "@mapos/layer-sdk";
import { SocialWorld } from "../world/socialWorld.js";
import { ClientError } from "../utils/clientError.js";
import { GotchiAssets } from "../world/gotchi.js";

export interface WorldRouteOptions {
  world: SocialWorld;
  enabled?: boolean;
  resolveUser(request: FastifyRequest): Promise<WorldProfile | null>;
  origins: string[];
  saveThread?: (userId: string, thread: GeoThread) => Promise<void>;
  moderator?: (request: FastifyRequest) => boolean | Promise<boolean>;
}
export async function registerWorldRoutes(app: FastifyInstance, options: WorldRouteOptions) {
  const { world } = options;
  const assets = new GotchiAssets();
  // Retire browser-trusted reward/profile mutation paths across both server adapters.
  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0]!;
    if (
      options.enabled === false &&
      path.startsWith("/v2/world/") &&
      path !== "/v2/world/capabilities"
    )
      throw new ClientError("Vrstva je vypnutá", 503);
    if (
      request.method !== "GET" &&
      (path === "/games/state" ||
        path === "/game/orbs/collect" ||
        /^\/game\/(ghosts|encounters|quests)\/[^/]+\/(catch|resolve|complete)$/.test(path))
    )
      throw new ClientError("Použij autoritativní herní session", 410);
  });
  await app.register(websocket, { options: { maxPayload: 8192 } });
  const rates = new Map<string, { start: number; count: number }>();
  function rate(id: string, limit = 60) {
    const now = Date.now();
    let r = rates.get(id);
    if (!r || now - r.start > 60000) {
      r = { start: now, count: 0 };
      rates.set(id, r);
    }
    if (++r.count > limit) throw new ClientError("Zkus to prosím za chvíli", 429);
  }
  async function actor(request: FastifyRequest) {
    const user = await options.resolveUser(request);
    if (!user) throw new ClientError("Přihlas se do MapOS", 401);
    return user;
  }
  const root = "/v2/world";
  function post(
    path: string,
    fn: (
      user: WorldProfile,
      body: Record<string, unknown>,
      request: FastifyRequest
    ) => Promise<unknown> | unknown
  ) {
    app.post(root + path, { bodyLimit: 16000 }, async (request, reply) => {
      if (request.headers.origin && !options.origins.includes(request.headers.origin))
        throw new ClientError("Nepovolený původ požadavku", 403);
      reply.header("Cache-Control", "private, no-store");
      const user = await actor(request);
      rate(`${user.id}:${path}`, path === "/position" || path === "/action" ? 240 : 60);
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new ClientError("Chybí požadavek");
      return fn(user, body as Record<string, unknown>, request);
    });
  }
  const sid = (body: Record<string, unknown>) => String(body.sessionId ?? "");
  app.get(root + "/capabilities", async () => ({
    testEnabled: world.options.testEnabled,
    enabled: options.enabled !== false,
    chatEncryption: "transport",
    raidMaxPlayers: 8
  }));
  post("/session", (u, b) => world.start(u.id, b.mode as "gps" | "test" | "explore"));
  post("/session/end", (u, b) => {
    world.end(u.id, sid(b));
    return { ok: true };
  });
  post("/position", (u, b) => {
    world.position(u.id, sid(b), b.position, b.accuracy, b.observedAt);
    return { ok: true };
  });
  post("/snapshot", (u, b) => world.snapshot(u.id, sid(b)));
  post("/action", (u, b) => world.action(u.id, sid(b), b.action as GameAction));
  post("/avatar", async (u, b) => {
    await world.selectAvatar(u.id, sid(b), String(b.tokenId ?? ""));
    return { ok: true };
  });
  // Fixed public appearance; ownership remains checked by /avatar.
  app.get(root + "/models/default", async (_request, reply) =>
    reply.header("Cache-Control", "public, max-age=5").send(await assets.defaultModel())
  );
  post("/models/request", (u, b) => {
    const tokenId = world.player(u.id, sid(b)).session.avatarTokenId;
    if (!tokenId) throw new ClientError("Nejdřív vyber ověřeného gotchi", 403);
    return b.retry === true ? assets.retry(tokenId) : assets.request(tokenId);
  });
  app.get<{ Params: { hash: string } }>(root + "/models/:hash.glb", async (request, reply) => {
    const appearance = await assets.defaultModel();
    const requestedUrl = `/api/v2/world/models/${request.params.hash}.glb`;
    const publicAppearance =
      appearance.status === "ready" &&
      (appearance.url === requestedUrl || appearance.lods?.some((lod) => lod.url === requestedUrl));
    if (!publicAppearance) await actor(request);
    try {
      return reply
        .type("model/gltf-binary")
        .header("Cache-Control", "private, max-age=86400")
        .send(await assets.read(request.params.hash));
    } catch {
      throw new ClientError("Model nebyl nalezen", 404);
    }
  });
  post("/quests", (u, b) => {
    if (typeof b.actionId !== "string") throw new ClientError("Chybí identifikátor questu");
    return world.createQuest(u.id, sid(b), b);
  });
  post("/presence", (u, b) => world.setPresence(u.id, sid(b), b));
  const nearby = async (userId: string, sessionId: string) =>
    (await world.nearby(userId, sessionId)).map((p) => ({
      ...p,
      ...(p.profile && p.avatarTokenId ? { model: assets.request(p.avatarTokenId) } : {})
    }));
  post("/nearby", (u, b) => nearby(u.id, sid(b)));
  post("/position-share", (u, b) =>
    world.sharePosition(u.id, sid(b), String(b.userId ?? ""), b.enabled === true)
  );
  post("/contacts", (u) => world.contacts(u.id));
  post("/contacts/request", (u, b) =>
    world.requestContact(u.id, b as { presenceId?: string; userId?: string; sessionId?: string })
  );
  post("/contacts/respond", (u, b) => world.respond(u.id, String(b.id ?? ""), b.accept === true));
  post("/contacts/favorite", (u, b) =>
    world.favorite(u.id, String(b.id ?? ""), b.enabled === true)
  );
  post("/contacts/disconnect", (u, b) => world.disconnect(u.id, String(b.id ?? "")));
  post("/contacts/block", (u, b) =>
    b.presenceId
      ? world.blockPresence(u.id, sid(b), String(b.presenceId))
      : world.block(u.id, String(b.userId ?? ""))
  );
  post("/dm/history", (u, b) =>
    world.privateMessages(
      u.id,
      String(b.id ?? ""),
      b.before === undefined ? undefined : Number(b.before)
    )
  );
  post("/dm/send", (u, b) => world.sendPrivate(u.id, String(b.id ?? ""), b.body, b.actionId));
  post("/dm/read", (u, b) => world.markRead(u.id, String(b.id ?? "")));
  post("/threads/search", (u, b) => world.threads(u.id, b));
  post("/threads/create", async (u, b) => {
    const thread = await world.createThread(u.id, b);
    if (thread.kind === "place") await options.saveThread?.(u.id, thread);
    return thread;
  });
  post("/threads/save", async (u, b) => {
    const thread = await world.thread(String(b.id ?? ""));
    if (!options.saveThread) throw new ClientError("Uložení není dostupné", 503);
    await options.saveThread(u.id, thread);
    return { ok: true };
  });
  post("/threads/get", (_u, b) => world.thread(String(b.id ?? "")));
  post("/threads/edit", (u, b) => world.editThread(u.id, String(b.id ?? ""), b));
  post("/threads/replies", (_u, b) =>
    world.replies(String(b.id ?? ""), b.before === undefined ? undefined : Number(b.before))
  );
  post("/threads/reply", (u, b) => world.reply(u.id, String(b.id ?? ""), b.body, b.actionId));
  post("/threads/report", (u, b) => world.report(u.id, String(b.id ?? ""), b.reason));
  post("/threads/moderate", async (_u, b, request) => {
    if (!(await options.moderator?.(request))) throw new ClientError("Nedostupné", 403);
    return world.moderate(String(b.id ?? ""));
  });
  app.get(
    root + "/live",
    {
      websocket: true,
      preValidation: async (request) => {
        if (!request.headers.origin || !options.origins.includes(request.headers.origin))
          throw new ClientError("Nepovolený původ spojení", 403);
        await actor(request);
      }
    },
    (socket, request) => {
      let sessionId: string | null = null,
        closed = false,
        busy = false;
      const send = (value: unknown) => {
        if (socket.readyState === 1 && socket.bufferedAmount < 128000)
          socket.send(JSON.stringify(value));
      };
      socket.on("message", (raw: { toString(): string }) => {
        void (async () => {
          try {
            const u = await actor(request);
            rate(`${u.id}:socket`, 1200);
            const message = JSON.parse(raw.toString()) as Record<string, unknown>;
            if (message.type === "subscribe") {
              sessionId = String(message.sessionId ?? "");
              world.player(u.id, sessionId);
              send({ type: "subscribed" });
            } else if (sessionId && message.type === "position")
              world.position(
                u.id,
                sessionId,
                message.position,
                message.accuracy,
                message.observedAt
              );
            else if (sessionId && message.type === "action")
              send({
                type: "snapshot",
                snapshot: await world.action(u.id, sessionId, message.action as GameAction)
              });
            else throw new ClientError("Neznámá událost");
          } catch (error) {
            send({
              type: "error",
              message: error instanceof ClientError ? error.message : "Událost se nepodařila"
            });
          }
        })();
      });
      const timer = setInterval(() => {
        if (closed || busy || !sessionId) return;
        busy = true;
        void (async () => {
          try {
            const u = await actor(request);
            const snapshot = await world.snapshot(u.id, sessionId!);
            let presence: unknown[] = [];
            if (snapshot.positionReady) presence = await nearby(u.id, sessionId!);
            send({ type: "snapshot", snapshot, presence });
            send({ type: "social-refresh" });
          } catch {
            socket.close(1008, "Session expired");
          } finally {
            busy = false;
          }
        })();
      }, 1000);
      socket.on("close", () => {
        closed = true;
        clearInterval(timer);
      });
    }
  );
  const tick = setInterval(() => world.tick(), 100);
  tick.unref();
  const cleanup = setInterval(() => {
    for (const [k, v] of rates) if (Date.now() - v.start > 60000) rates.delete(k);
  }, 60000);
  cleanup.unref();
  app.addHook("onClose", async () => {
    clearInterval(tick);
    clearInterval(cleanup);
  });
}
