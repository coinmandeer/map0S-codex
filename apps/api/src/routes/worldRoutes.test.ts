import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerWorldRoutes } from "./worldRoutes.js";
import { SocialWorld } from "../world/socialWorld.js";
import { MemoryWorldRepository } from "../world/repository.js";
import { registerClientSafeErrorHandler } from "../utils/clientError.js";
import { buildMemoryApp } from "../memory-server.js";

test("world HTTP access, retired reward paths, CSRF origin and 100 live connections", async (t) => {
  const app = Fastify({ logger: false });
  registerClientSafeErrorHandler(app);
  const world = new SocialWorld(new MemoryWorldRepository(), {
    testEnabled: true,
    profile: async (id) => ({ id, displayName: id })
  });
  await registerWorldRoutes(app, {
    world,
    origins: ["http://localhost:5173"],
    resolveUser: async (req) =>
      typeof req.headers["x-test-user"] === "string"
        ? { id: req.headers["x-test-user"], displayName: req.headers["x-test-user"] }
        : null
  });
  app.post("/game/orbs/collect", async () => ({ unsafe: true }));
  await app.ready();
  t.after(() => app.close());
  const post = (url: string, payload: unknown, user = "alice") =>
    app.inject({
      method: "POST",
      url,
      payload: payload as Record<string, unknown>,
      headers: user ? { "x-test-user": user } : {}
    });
  assert.equal((await post("/v2/world/session", { mode: "test" }, "")).statusCode, 401);
  assert.equal((await post("/game/orbs/collect", { orbIds: ["anything"] })).statusCode, 410);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/v2/world/live",
        headers: { origin: "https://evil.invalid", "x-test-user": "alice" }
      })
    ).statusCode,
    403
  );
  const session = (await post("/v2/world/session", { mode: "test" })).json();
  assert.equal(
    (
      await post(
        "/v2/world/position",
        { sessionId: session.id, position: { lng: 14.425, lat: 50.085 }, accuracy: 0 },
        "intruder"
      )
    ).statusCode,
    409
  );
  assert.equal((await post("/v2/world/dm/history", { id: "guessed" })).statusCode, 403);
  const started = performance.now();
  let snapshots = 0;
  const sockets = [];
  for (let i = 0; i < 100; i++) {
    const user = `live-${i}`,
      s = world.start(user, "test");
    world.position(user, s.id, { lng: 14.425, lat: 50.085 }, 0);
    await world.setPresence(user, s.id, { visible: true });
    const socket = await app.injectWS("/v2/world/live", {
      headers: { origin: "http://localhost:5173", "x-test-user": user }
    });
    socket.on("message", (raw: { toString(): string }) => {
      if (JSON.parse(raw.toString()).type === "snapshot") snapshots++;
    });
    socket.send(JSON.stringify({ type: "subscribe", sessionId: s.id }));
    sockets.push(socket);
  }
  await new Promise((r) => setTimeout(r, 2200));
  for (const socket of sockets) socket.close();
  assert.ok(snapshots >= 100, `${snapshots} snapshots`);
  assert.ok(performance.now() - started < 15000);
  t.diagnostic(
    `100 sockets delivered ${snapshots} snapshots in ${Math.round(performance.now() - started)}ms`
  );
});
test("memory composition persists a geo thread through existing Moje places and reconnect", async (t) => {
  const app = await buildMemoryApp({ offlineFixture: true });
  t.after(() => app.close());
  const guest = await app.inject({ method: "POST", url: "/auth/guest", payload: {} });
  assert.equal(guest.statusCode, 200, guest.body);
  const cookie = guest.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url, payload, headers: { cookie } });
  const created = await post("/v2/world/threads/create", {
    kind: "place",
    lng: 14.425,
    lat: 50.085,
    title: "Meet here",
    body: "A persistent map message",
    actionId: "saved-once"
  });
  assert.equal(created.statusCode, 200, created.body);
  const thread = created.json();
  const saved = await post("/v2/world/threads/save", { id: thread.id });
  assert.equal(saved.statusCode, 200, saved.body);
  await post("/v2/world/threads/save", { id: thread.id });
  const places = await app.inject({
    method: "GET",
    url: "/v2/me/saved-places",
    headers: { cookie }
  });
  assert.ok(places.body.includes(`social-thread:${thread.id}`));
  assert.equal(
    places
      .json()
      .savedPlaces.filter(
        (p: { target: { externalFeatureRef?: string } }) =>
          p.target.externalFeatureRef === `social-thread:${thread.id}`
      ).length,
    1
  );
  assert.equal(
    (await post("/v2/world/threads/get", { id: thread.id })).json().body,
    "A persistent map message"
  );
  const blocked = await post("/game/orbs/collect", { orbIds: ["made-up"] });
  assert.equal(blocked.statusCode, 410);
});
