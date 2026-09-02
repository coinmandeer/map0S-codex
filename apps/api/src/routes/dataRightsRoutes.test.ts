import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import {
  DataRightsService,
  type AccountDeletionResult,
  type AccountExportData,
  type DataRightsRepository
} from "../services/dataRightsService.js";
import { registerDataRightsRoutes } from "./dataRightsRoutes.js";

const fixture: AccountExportData = {
  account: { id: "user-1", email: "owner@example.test" },
  identities: [],
  layers: [{ id: "layer-1", pins: [{ id: "pin-1" }] }],
  layerImports: [],
  places: { saved: [{ id: "place-1" }], collections: [] },
  plans: [{ id: "plan-1" }],
  social: { follows: [], reviews: [], comments: [{ id: "comment-1" }], drafts: [] },
  game: {
    questCompletions: [],
    orbCollections: [],
    profiles: [],
    staking: [],
    rewards: [],
    caughtGhosts: [],
    encounters: []
  },
  commerce: { orders: [], subscriptions: [], entitlements: [], tips: [] }
};

function repository(deletion: AccountDeletionResult = { status: "deleted", retained: [] }) {
  let deleteCalls = 0;
  const value: DataRightsRepository = {
    async exportForOwner(userId) {
      return userId === "user-1" ? structuredClone(fixture) : null;
    },
    async deleteForOwner(userId) {
      deleteCalls += 1;
      return userId === "user-1" ? structuredClone(deletion) : null;
    }
  };
  return { value, deleteCalls: () => deleteCalls };
}

function buildRouteApp(repo: ReturnType<typeof repository>) {
  const app = Fastify();
  let cleared = false;
  registerDataRightsRoutes(app, {
    service: new DataRightsService(repo.value, () => new Date("2026-09-01T12:00:00.000Z")),
    resolveUserId(request) {
      return request.headers.authorization === "Bearer owner" ? "user-1" : null;
    },
    clearSession(reply) {
      cleared = true;
      reply.header("Set-Cookie", "session=; Max-Age=0; Path=/; HttpOnly");
    }
  });
  return { app, cleared: () => cleared };
}

describe("account data-rights routes", () => {
  it("exports every portable owner domain with a stable policy envelope and no-store headers", async () => {
    const repo = repository();
    const { app } = buildRouteApp(repo);
    const unauthorized = await app.inject({ method: "GET", url: "/v2/me/export" });
    assert.equal(unauthorized.statusCode, 401);

    const response = await app.inject({
      method: "GET",
      url: "/v2/me/export",
      headers: { authorization: "Bearer owner" }
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.headers["cache-control"] ?? "", /no-store/);
    assert.match(response.headers["content-disposition"] ?? "", /mapos-account-export\.json/);
    const body = response.json();
    assert.equal(body.schema, "mapos.account-export");
    assert.equal(body.generatedAt, "2026-09-01T12:00:00.000Z");
    assert.equal(body.layers[0].pins[0].id, "pin-1");
    assert.equal(body.places.saved[0].id, "place-1");
    assert.equal(body.plans[0].id, "plan-1");
    assert.equal(body.social.comments[0].id, "comment-1");
    assert.ok(body.exclusions.includes("provider-secrets-and-payment-payloads"));
    await app.close();
  });

  it("requires an exact destructive confirmation and clears the session after atomic deletion", async () => {
    const repo = repository({
      status: "deleted-with-retention",
      retained: [
        {
          domain: "commerce-audit",
          reason: "legal-and-financial-record",
          dataState: "pseudonymized-and-deactivated"
        }
      ]
    });
    const { app, cleared } = buildRouteApp(repo);
    const rejected = await app.inject({
      method: "DELETE",
      url: "/v2/me",
      headers: { authorization: "Bearer owner" },
      payload: { confirmation: "delete" }
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal(repo.deleteCalls(), 0);

    const response = await app.inject({
      method: "DELETE",
      url: "/v2/me",
      headers: { authorization: "Bearer owner" },
      payload: { confirmation: "DELETE MY ACCOUNT" }
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().status, "deleted-with-retention");
    assert.equal(response.json().retained[0].dataState, "pseudonymized-and-deactivated");
    assert.equal(repo.deleteCalls(), 1);
    assert.equal(cleared(), true);
    assert.match(String(response.headers["set-cookie"]), /Max-Age=0/);
    await app.close();
  });

  it("rejects unknown body fields instead of silently normalizing the destructive request", async () => {
    const repo = repository();
    const { app } = buildRouteApp(repo);
    const response = await app.inject({
      method: "DELETE",
      url: "/v2/me",
      headers: { authorization: "Bearer owner" },
      payload: { confirmation: "DELETE MY ACCOUNT", keepPlans: true }
    });
    assert.equal(response.statusCode, 400);
    assert.equal(repo.deleteCalls(), 0);
    await app.close();
  });
});
