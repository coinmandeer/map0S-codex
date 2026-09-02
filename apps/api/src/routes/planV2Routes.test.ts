import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import {
  planV1ToV2,
  type Place,
  type PlanDocumentV2,
  type PlanTemporalContextV2,
  type Position
} from "@mapos/layer-sdk";
import { ClientError } from "../utils/clientError.js";
import type { PlanDocumentRepository } from "../services/planDocumentRepository.js";
import type { PlanShareLink, PlanShareRepository } from "../services/planShareRepository.js";
import type { AdjacentRouteProvider } from "../services/segmentRoutingService.js";
import { registerPlanV2Routes } from "./planV2Routes.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function planWithStops(count: number): PlanDocumentV2 {
  return planV1ToV2(
    {
      id: `plan-${count}`,
      name: "Route contract",
      departureAt: "2026-09-01T08:00:00.000Z",
      variant: "fast",
      stops: Array.from({ length: count }, (_, index) => ({
        id: `stop-${index}`,
        name: `Stop ${index}`,
        lng: 10 + index / 10_000,
        lat: 45 + index / 10_000,
        dwellMinutes: 0
      })),
      vehicle: { profile: "car" },
      visibility: "private"
    },
    { now: "2026-09-01T08:00:00.000Z" }
  );
}

function repository(): PlanDocumentRepository {
  const rows = new Map<string, { ownerId: string; plan: PlanDocumentV2 }>();
  return {
    async list(ownerId) {
      return [...rows.values()]
        .filter((row) => row.ownerId === ownerId)
        .map((row) => clone(row.plan));
    },
    async get(ownerId, id) {
      const row = rows.get(id);
      return row?.ownerId === ownerId ? clone(row.plan) : null;
    },
    async create(ownerId, input) {
      const plan = {
        ...clone(input),
        id: `stored-${rows.size + 1}`,
        ownerId,
        metadata: { ...(input.metadata ?? {}), "dev.mapos.persisted": true }
      };
      rows.set(plan.id, { ownerId, plan: clone(plan) });
      return plan;
    },
    async replace(ownerId, id, input, expectedRevision) {
      const row = rows.get(id);
      if (!row || row.ownerId !== ownerId) throw new ClientError("Plán nebyl nalezen", 404);
      if (row.plan.revision !== expectedRevision) throw new ClientError("Konflikt revize", 409);
      const plan = {
        ...clone(input),
        id,
        ownerId,
        revision: Math.max(row.plan.revision + 1, input.revision)
      };
      row.plan = clone(plan);
      return plan;
    },
    async delete(ownerId, id) {
      const row = rows.get(id);
      if (!row || row.ownerId !== ownerId) throw new ClientError("Plán nebyl nalezen", 404);
      rows.delete(id);
    }
  };
}

function sharingRepository(plans: PlanDocumentRepository): PlanShareRepository {
  const rows = new Map<string, { ownerId: string; tokenHash: string; share: PlanShareLink }>();
  return {
    async list(ownerId, planId) {
      return [...rows.values()]
        .filter((row) => row.ownerId === ownerId && row.share.planId === planId)
        .map((row) => clone(row.share));
    },
    async create(ownerId, planId, tokenHash, permission) {
      const share: PlanShareLink = {
        id: `share-${rows.size + 1}`,
        planId,
        permission,
        createdAt: "2026-09-02T10:00:00.000Z",
        revokedAt: null
      };
      rows.set(share.id, { ownerId, tokenHash, share });
      return clone(share);
    },
    async resolve(tokenHash) {
      const row = [...rows.values()].find(
        (candidate) => candidate.tokenHash === tokenHash && !candidate.share.revokedAt
      );
      if (!row) return null;
      const plan = await plans.get(row.ownerId, row.share.planId);
      return plan ? { share: clone(row.share), plan } : null;
    },
    async revoke(ownerId, planId, shareId) {
      const row = rows.get(shareId);
      if (!row || row.ownerId !== ownerId || row.share.planId !== planId) {
        throw new ClientError("Odkaz nebyl nalezen", 404);
      }
      row.share.revokedAt = "2026-09-02T10:05:00.000Z";
    }
  };
}

function provider(options: { failFromLongitude?: number; delay?: boolean } = {}) {
  const endpoints: Array<readonly [Position, Position]> = [];
  let active = 0;
  let maximumActive = 0;
  const value: AdjacentRouteProvider = {
    id: options.failFromLongitude === undefined ? "route-fixture" : "route-fixture-with-failure",
    async route(request) {
      endpoints.push(clone(request.endpoints));
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        if (options.delay) await new Promise((resolve) => setTimeout(resolve, 1));
        if (request.endpoints[0][0] === options.failFromLongitude) {
          throw new Error("fixture route failure");
        }
        return {
          alternatives: [
            {
              geometry: {
                type: "LineString",
                coordinates: request.endpoints.map((point) => [...point] as Position)
              },
              distanceM: 1_000,
              durationS: 60
            }
          ]
        };
      } finally {
        active -= 1;
      }
    }
  };
  return { value, endpoints, maximumActive: () => maximumActive };
}

function appWith(
  providerValue: AdjacentRouteProvider,
  repo = repository(),
  shares = sharingRepository(repo),
  findAdventurePlaces?: () => Promise<{ places: Place[]; sourceStates: [] }>,
  temporalContextForPlan?: () => Promise<PlanTemporalContextV2>
) {
  const app = Fastify();
  registerPlanV2Routes(app, {
    repository: repo,
    shareRepository: shares,
    resolveUserId: (request) => {
      const header = request.headers["x-user-id"];
      return typeof header === "string" ? header : null;
    },
    providerFor: () => providerValue,
    findAdventurePlaces,
    temporalContextForPlan
  });
  return app;
}

describe("PlanDocument v2 routes", () => {
  it("exposes bounded dated context as a separate honest planning response", async () => {
    const expected: PlanTemporalContextV2 = {
      status: "active",
      planId: "plan-3",
      departureAt: "2026-09-01T08:00:00.000Z",
      generatedAt: "2026-09-02T10:00:00.000Z",
      temporalControls: {
        cursor: "2026-09-01T08:00:00.000Z",
        minimum: "2026-09-01T00:00:00.000Z",
        maximum: "2026-09-09T00:00:00.000Z"
      },
      weather: {
        status: "unavailable",
        sampledStops: 0,
        totalStops: 3,
        source: null,
        reason: "Provider nevrátil data; nic se nesimuluje."
      },
      traffic: {
        status: "unavailable",
        source: null,
        reason: "Provider nevrátil data; nic se nesimuluje."
      },
      stops: [],
      segments: [],
      dataBudget: { maxWeatherStops: 20, sampledStops: 3, upstreamWeatherRequests: 1 }
    };
    const app = appWith(provider().value, undefined, undefined, undefined, async () => expected);
    const response = await app.inject({
      method: "POST",
      url: "/v2/routing/temporal-context",
      payload: { plan: planWithStops(3), provider: "osm" }
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), expected);
    await app.close();
  });

  it("exposes a bounded deterministic adventure analysis only for the adventure profile", async () => {
    let searches = 0;
    const app = appWith(provider().value, undefined, undefined, async () => {
      searches += 1;
      return { places: [], sourceStates: [] };
    });
    const input = planWithStops(2);
    const rejected = await app.inject({
      method: "POST",
      url: "/v2/routing/adventure",
      payload: { plan: input, detourLimitPercent: 15 }
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal(searches, 0);

    input.routePolicy.preference = "adventure";
    const response = await app.inject({
      method: "POST",
      url: "/v2/routing/adventure",
      payload: { plan: input, provider: "osm", detourLimitPercent: 15, maximumSuggestions: 3 }
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as {
      algorithm: { version: string; deterministic: boolean; detourLimitPercent: number };
      suggestions: unknown[];
      dataBudget: { maxReturnedSuggestions: number; sources: string[] };
    };
    assert.equal(searches, 1);
    assert.equal(body.algorithm.version, "mapos-adventure-v1");
    assert.equal(body.algorithm.deterministic, true);
    assert.equal(body.algorithm.detourLimitPercent, 15);
    assert.deepEqual(body.suggestions, []);
    assert.equal(body.dataBudget.maxReturnedSuggestions, 3);
    assert.deepEqual(body.dataBudget.sources, ["osm"]);
    await app.close();
  });

  it("routes 250 stops as 249 bounded two-endpoint provider calls", async () => {
    const fixture = provider({ delay: true });
    const app = appWith(fixture.value);
    const response = await app.inject({
      method: "POST",
      url: "/v2/routing/plan",
      payload: { plan: planWithStops(250), provider: "osm" }
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as {
      plan: PlanDocumentV2;
      stats: { providerCalls: number; maxConcurrency: number };
    };
    assert.equal(body.plan.segments.length, 249);
    assert.equal(body.stats.providerCalls, 249);
    assert.equal(fixture.endpoints.length, 249);
    assert.ok(fixture.endpoints.every((points) => points.length === 2));
    assert.ok(fixture.maximumActive() <= 4);
    await app.close();
  });

  it("returns partial segment state instead of discarding the plan", async () => {
    const fixture = provider({ failFromLongitude: 10.0001 });
    const app = appWith(fixture.value);
    const response = await app.inject({
      method: "POST",
      url: "/v2/routing/plan",
      payload: { plan: planWithStops(4) }
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { plan: PlanDocumentV2; failedSegmentIds: string[] };
    assert.equal(body.failedSegmentIds.length, 1);
    assert.equal(body.plan.segments.filter((segment) => segment.status === "ready").length, 2);
    assert.equal(body.plan.segments.filter((segment) => segment.status === "failed").length, 1);
    await app.close();
  });

  it("enforces owner ACL and optimistic revisions across save and commands", async () => {
    const fixture = provider();
    const app = appWith(fixture.value);
    const unauthorized = await app.inject({ method: "GET", url: "/v2/plans" });
    assert.equal(unauthorized.statusCode, 401);

    const createdResponse = await app.inject({
      method: "POST",
      url: "/v2/plans",
      headers: { "x-user-id": "owner-a" },
      payload: { plan: planWithStops(4) }
    });
    assert.equal(createdResponse.statusCode, 200, createdResponse.body);
    const created = (createdResponse.json() as { plan: PlanDocumentV2 }).plan;

    const hidden = await app.inject({
      method: "GET",
      url: `/v2/plans/${created.id}`,
      headers: { "x-user-id": "owner-b" }
    });
    assert.equal(hidden.statusCode, 404);

    const escalation = await app.inject({
      method: "POST",
      url: `/v2/plans/${created.id}/commands`,
      headers: { "x-user-id": "owner-a" },
      payload: {
        id: "escalate",
        expectedRevision: created.revision,
        command: {
          type: "update-plan",
          patch: { ownerId: "owner-b", id: "stolen", revision: 999 }
        }
      }
    });
    assert.equal(escalation.statusCode, 400);

    const commandResponse = await app.inject({
      method: "POST",
      url: `/v2/plans/${created.id}/commands`,
      headers: { "x-user-id": "owner-a" },
      payload: {
        id: "move-command",
        expectedRevision: created.revision,
        command: { type: "move-stop", stopId: "stop-2", toIndex: 1 }
      }
    });
    assert.equal(commandResponse.statusCode, 200, commandResponse.body);
    const moved = (commandResponse.json() as { plan: PlanDocumentV2 }).plan;
    assert.deepEqual(
      moved.stops.map((stop) => stop.id),
      ["stop-0", "stop-2", "stop-1", "stop-3"]
    );
    assert.equal(moved.revision, created.revision + 1);

    const stale = await app.inject({
      method: "PATCH",
      url: `/v2/plans/${created.id}`,
      headers: { "x-user-id": "owner-a" },
      payload: { plan: moved, expectedRevision: created.revision }
    });
    assert.equal(stale.statusCode, 409);
    await app.close();
  });

  it("exports the current draft deterministically without authentication", async () => {
    const app = appWith(provider().value);
    const plan = planWithStops(2);
    const first = await app.inject({
      method: "POST",
      url: "/v2/plans/export/gpx",
      payload: { plan }
    });
    const second = await app.inject({
      method: "POST",
      url: "/v2/plans/export/gpx",
      payload: { plan }
    });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), second.json());
    assert.match((first.json() as { content: string }).content, /<gpx version="1\.1"/);

    const unsupported = await app.inject({
      method: "POST",
      url: "/v2/plans/export/pdf",
      payload: { plan }
    });
    assert.equal(unsupported.statusCode, 400);

    const unexpectedQuery = await app.inject({
      method: "GET",
      url: "/v2/plans?cursor=unbounded",
      headers: { "x-user-id": "owner-a" }
    });
    assert.equal(unexpectedQuery.statusCode, 400);
    await app.close();
  });

  it("creates a revocable read-only share without exposing notes, owner or token digest", async () => {
    const app = appWith(provider().value);
    const privatePlan = planWithStops(2);
    privatePlan.ownerId = "owner-a";
    privatePlan.stops[0]!.notes = "tajná zastávka";
    privatePlan.conversationIds = ["private-conversation"];
    privatePlan.metadata = { secret: "never-share" };
    const createdResponse = await app.inject({
      method: "POST",
      url: "/v2/plans",
      headers: { "x-user-id": "owner-a" },
      payload: { plan: privatePlan }
    });
    const created = (createdResponse.json() as { plan: PlanDocumentV2 }).plan;
    const linkResponse = await app.inject({
      method: "POST",
      url: `/v2/plans/${created.id}/shares`,
      headers: { "x-user-id": "owner-a" },
      payload: { permission: "view" }
    });
    assert.equal(linkResponse.statusCode, 200, linkResponse.body);
    const link = linkResponse.json() as {
      token: string;
      share: PlanShareLink;
    };
    assert.equal(link.token.length, 43);
    assert.doesNotMatch(linkResponse.body, /tokenHash|tajná zastávka|never-share/);

    const publicResponse = await app.inject({
      method: "POST",
      url: "/v2/plans/shared/resolve",
      payload: { token: link.token }
    });
    assert.equal(publicResponse.statusCode, 200, publicResponse.body);
    assert.equal(publicResponse.headers["cache-control"], "no-store");
    const shared = (publicResponse.json() as { permission: string; plan: PlanDocumentV2 }).plan;
    assert.equal(shared.ownerId, null);
    assert.equal(shared.visibility, "unlisted");
    assert.equal(shared.stops[0]?.notes, undefined);
    assert.deepEqual(shared.conversationIds, []);
    assert.doesNotMatch(publicResponse.body, /owner-a|private-conversation|never-share/);

    const hiddenManagement = await app.inject({
      method: "GET",
      url: `/v2/plans/${created.id}/shares`,
      headers: { "x-user-id": "owner-b" }
    });
    assert.equal(hiddenManagement.statusCode, 404);
    const revoke = await app.inject({
      method: "DELETE",
      url: `/v2/plans/${created.id}/shares/${link.share.id}`,
      headers: { "x-user-id": "owner-a" }
    });
    assert.equal(revoke.statusCode, 204, revoke.body);
    const revoked = await app.inject({
      method: "POST",
      url: "/v2/plans/shared/resolve",
      payload: { token: link.token }
    });
    assert.equal(revoked.statusCode, 404);
    await app.close();
  });
});
