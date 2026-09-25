import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerChatHistoryRoutes } from "./chatHistoryRoutes.js";
import { memoryChatHistory, type HistoryTurn } from "../services/ai/chatHistory.js";
import { memoryMapArtifacts } from "../services/ai/mapArtifacts.js";
const turn: HistoryTurn = {
  id: "turn",
  question: "Výlet",
  requestedAt: new Date().toISOString(),
  text: "",
  cards: [],
  sources: [],
  followUps: [],
  done: true,
  error: null,
  step: null,
  scopeKey: "",
  scopeLabel: ""
};
test("history enforces owner, map revision, archival and deletion without resurrection", async () => {
  const repo = memoryChatHistory(),
    app = Fastify();
  registerChatHistoryRoutes(app, repo, (req) => String(req.headers["x-test-owner"] ?? "") || null);
  await repo.turn("alice", "one", 2, turn);
  const request = (
    owner: string,
    method: "GET" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown
  ) =>
    app.inject({
      method,
      url,
      headers: { "x-test-owner": owner },
      ...(payload ? { payload } : {})
    });
  assert.equal((await request("bob", "GET", "/v2/ai/conversations/one")).statusCode, 404);
  assert.equal((await request("bob", "DELETE", "/v2/ai/conversations/one")).statusCode, 404);
  assert.equal(
    (
      await request("alice", "PATCH", "/v2/ai/conversations/one", {
        workspace: null,
        baseRevision: 1
      })
    ).statusCode,
    409
  );
  assert.equal(
    (
      await request("alice", "PATCH", "/v2/ai/conversations/one", {
        title: "Málaga",
        baseRevision: 2
      })
    ).statusCode,
    200
  );
  assert.equal((await repo.get("alice", "one"))?.title, "Málaga");
  assert.equal(
    (
      await request("alice", "PATCH", "/v2/ai/conversations/one", {
        workspace: { appearance: {}, view: { lng: 200, lat: 0, zoom: 5 } },
        baseRevision: 2
      })
    ).statusCode,
    400
  );
  await repo.patch("alice", "one", { archived: true });
  assert.equal(await repo.unavailable("alice", "one"), true);
  assert.equal((await repo.list("alice", 0)).length, 0);
  const archived = await request("alice", "GET", "/v2/ai/conversations?archived=1");
  assert.equal(archived.json().conversations[0]?.archived, true);
  assert.equal(
    (await request("bob", "GET", "/v2/ai/conversations?archived=1")).json().conversations.length,
    0
  );
  assert.equal((await request("alice", "DELETE", "/v2/ai/conversations/one")).statusCode, 200);
  await repo.turn("alice", "one", 3, turn);
  assert.equal(await repo.get("alice", "one"), null);
  assert.equal(await repo.unavailable("alice", "one"), true);
  await app.close();
});

test("workspace references require artifact ownership and the same conversation", async () => {
  const repo = memoryChatHistory(),
    artifacts = memoryMapArtifacts(),
    app = Fastify();
  registerChatHistoryRoutes(
    app,
    repo,
    (req) => String(req.headers["x-test-owner"] ?? "") || null,
    artifacts
  );
  for (const [owner, id] of [
    ["alice", "one"],
    ["alice", "two"],
    ["bob", "three"]
  ]) {
    await repo.turn(owner!, id!, 1, turn);
    await artifacts.put(owner!, {
      schema: "mapos.map-result",
      schemaVersion: "1.0.0",
      id: `artifact-${id}`,
      conversationId: id!,
      runId: "run",
      revision: 1,
      title: "Verified result",
      style: { palette: "blue", opacity: 1 },
      sources: [{ id: "source", label: "Source" }],
      data: { type: "FeatureCollection", features: [] }
    });
  }
  const workspace = {
    appearance: {
      basemapId: "carto-dark",
      basemapLabels: true,
      buildings3d: false,
      terrain3d: false,
      poiSources: {},
      layers: {}
    },
    view: { lng: 0, lat: 0, zoom: 3 },
    plan: null,
    result: null,
    route: null
  };
  for (const artifactIds of [
    ["artifact-two"],
    ["artifact-three"],
    ["missing"],
    ["artifact-one", "artifact-one"]
  ]) {
    const response = await app.inject({
      method: "PATCH",
      url: "/v2/ai/conversations/one",
      headers: { "x-test-owner": "alice" },
      payload: { baseRevision: 1, workspace: { ...workspace, artifactIds } }
    });
    assert.equal(response.statusCode, 400);
  }
  const response = await app.inject({
    method: "PATCH",
    url: "/v2/ai/conversations/one",
    headers: { "x-test-owner": "alice" },
    payload: { baseRevision: 1, workspace: { ...workspace, artifactIds: ["artifact-one"] } }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(
    (await app.inject({ url: "/v2/ai/artifacts/artifact-one", headers: { "x-test-owner": "bob" } }))
      .statusCode,
    404
  );
  await repo.delete("alice", "one");
  assert.equal(
    (
      await app.inject({
        url: "/v2/ai/artifacts/artifact-one",
        headers: { "x-test-owner": "alice" }
      })
    ).statusCode,
    404
  );
  await app.close();
});
