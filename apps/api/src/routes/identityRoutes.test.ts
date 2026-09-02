import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import {
  GatedAavegotchiInventoryAdapter,
  SimulatedAavegotchiInventoryAdapter
} from "../services/identity/aavegotchiInventory.js";
import {
  LinkedIdentityService,
  MemoryIdentityRepository,
  type IdentityLink
} from "../services/identity/identityService.js";
import { registerIdentityRoutes, type IdentityRouteDependencies } from "./identityRoutes.js";

const address = "0x1234567890abcdef1234567890abcdef12345678";
const signature = `0x${"ab".repeat(65)}`;

async function fixture(simulationEnabled = false) {
  let sequence = 0;
  const repository = new MemoryIdentityRepository();
  const service = new LinkedIdentityService(
    repository,
    { id: "fixture", verify: async (input) => input.signature === signature },
    {
      domain: "mapos.example",
      uri: "https://mapos.example/v2/auth/siwe/verify",
      allowedChainIds: new Set([8453]),
      siweEnabled: true,
      simulationEnabled,
      now: () => new Date("2026-09-01T12:00:00.000Z"),
      createId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
      createNonce: () => `A1B2C3D4${String(sequence).padStart(8, "0")}`
    }
  );
  const rotations: string[] = [];
  const simulatedInventory = new SimulatedAavegotchiInventoryAdapter(
    [{ tokenId: "42", name: "Fixture", wearableIds: [], metadataSourceUrl: null }],
    true,
    () => new Date("2026-09-01T12:00:00.000Z")
  );
  const dependencies: IdentityRouteDependencies = {
    service,
    async resolveSession(request) {
      return request.headers.authorization === "Bearer valid"
        ? { userId: "user-1", sessionId: "session-1" }
        : null;
    },
    async rotateSession(userId, sessionId) {
      rotations.push(`${userId}:${sessionId}`);
      return { sessionId: "session-rotated", expiresAt: new Date("2027-09-01T00:00:00.000Z") };
    },
    applySession(reply, session) {
      reply.header("X-Test-Session", session.sessionId);
    },
    inventoryFor(identity: IdentityLink) {
      return identity.simulated
        ? simulatedInventory
        : new GatedAavegotchiInventoryAdapter(() => new Date("2026-09-01T12:00:00.000Z"));
    }
  };
  const app = Fastify();
  registerIdentityRoutes(app, dependencies);
  await app.ready();
  return { app, repository, rotations };
}

test("identity routes require the existing MapOS session and reject unknown fields", async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  assert.equal((await app.inject({ method: "GET", url: "/v2/me/identities" })).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v2/auth/siwe/challenge",
        headers: { authorization: "Bearer valid" },
        payload: { address, chainId: 8453, domain: "evil.example" }
      })
    ).statusCode,
    400
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/v2/me/identities?include=session",
        headers: { authorization: "Bearer valid" }
      })
    ).statusCode,
    400
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v2/auth/simulation/link",
        headers: { authorization: "Bearer valid" },
        payload: { label: "x".repeat(81) }
      })
    ).statusCode,
    400
  );
});

test("SIWE route links to the current user, rotates session and blocks replay", async (t) => {
  const { app, rotations } = await fixture();
  t.after(() => app.close());
  const headers = { authorization: "Bearer valid" };
  const challengeResponse = await app.inject({
    method: "POST",
    url: "/v2/auth/siwe/challenge",
    headers,
    payload: { address, chainId: 8453 }
  });
  assert.equal(challengeResponse.statusCode, 200);
  assert.equal(challengeResponse.headers["cache-control"], "private, no-store");
  const challenge = challengeResponse.json().challenge as { id: string; message: string };

  const verify = await app.inject({
    method: "POST",
    url: "/v2/auth/siwe/verify",
    headers,
    payload: { challengeId: challenge.id, message: challenge.message, signature }
  });
  assert.equal(verify.statusCode, 200);
  assert.equal(verify.headers["x-test-session"], "session-rotated");
  assert.deepEqual(rotations, ["user-1:session-1"]);
  assert.equal(verify.json().identity.subject, address);

  const replay = await app.inject({
    method: "POST",
    url: "/v2/auth/siwe/verify",
    headers,
    payload: { challengeId: challenge.id, message: challenge.message, signature }
  });
  assert.equal(replay.statusCode, 400);
  const listing = await app.inject({
    method: "GET",
    url: "/v2/me/identities",
    headers
  });
  assert.equal(listing.json().identities.length, 1);
  assert.equal("userId" in listing.json().identities[0], false);
});

test("simulation is a gated, visibly labeled adapter with fixture-only inventory", async (t) => {
  const disabled = await fixture(false);
  t.after(() => disabled.app.close());
  const headers = { authorization: "Bearer valid" };
  assert.equal(
    (
      await disabled.app.inject({
        method: "POST",
        url: "/v2/auth/simulation/link",
        headers,
        payload: {}
      })
    ).statusCode,
    404
  );

  const enabled = await fixture(true);
  t.after(() => enabled.app.close());
  const linked = await enabled.app.inject({
    method: "POST",
    url: "/v2/auth/simulation/link",
    headers,
    payload: { label: "Testovací peněženka" }
  });
  assert.equal(linked.statusCode, 200);
  assert.equal(linked.json().identity.simulated, true);
  const inventory = await enabled.app.inject({
    method: "GET",
    url: `/v2/me/aavegotchi-inventory?identityId=${linked.json().identity.id}`,
    headers
  });
  assert.equal(inventory.statusCode, 200);
  assert.equal(inventory.json().inventory.sourceMode, "simulation");
  assert.match(inventory.json().inventory.notice, /Testovací data/);
});
