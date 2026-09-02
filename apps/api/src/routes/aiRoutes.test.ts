import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { FixedWindowRateLimiter } from "../security/publicApiHardening.js";
import { planV1ToV2 } from "@mapos/layer-sdk";
import { createMemoryNearestPoiSource } from "../services/ai/nearestPoiSources.js";
import { createProviderNeutralAiRuntime } from "../services/ai/runtime.js";
import { buildMemoryApp } from "../memory-server.js";
import { registerAiRoutes } from "./aiRoutes.js";
import type { PlanDocumentRepository } from "../services/planDocumentRepository.js";
import type {
  PlanDiscussionRepository,
  PlanDiscussionThread
} from "../services/planDiscussionRepository.js";

const requestBody = {
  prompt: "Najdi mi nejbližší bar.",
  conversation: { mode: "new", scope: { type: "global" } },
  reference: { source: "map-center", longitude: 13.3775, latitude: 49.7475 },
  activeLayerIds: ["osm-poi"],
  activeFilters: {},
  radiusMeters: 2_000,
  limit: 3
} as const;

function fixtureSource(onQuery?: () => void) {
  const source = createMemoryNearestPoiSource(() => [
    {
      osmId: "node/demo-bar-0",
      category: "bar",
      name: "Irish Pub",
      lng: 13.378,
      lat: 49.747
    }
  ]);
  return {
    async query(...args: Parameters<typeof source.query>) {
      onQuery?.();
      return source.query(...args);
    }
  };
}

async function isolatedApp(options: { authenticated?: boolean; rateLimit?: number } = {}) {
  let sourceCalls = 0;
  let discussionCalls = 0;
  const historyLengths: number[] = [];
  let thread: PlanDiscussionThread | null = null;
  const storedPlan = discussionPlan();
  const planRepository: PlanDocumentRepository = {
    async list(ownerId) {
      return ownerId === "route-user" ? [structuredClone(storedPlan)] : [];
    },
    async get(ownerId, id) {
      return ownerId === "route-user" && id === storedPlan.id ? structuredClone(storedPlan) : null;
    },
    async create() {
      throw new Error("not used");
    },
    async replace() {
      throw new Error("not used");
    },
    async delete() {
      throw new Error("not used");
    }
  };
  const planDiscussionRepository: PlanDiscussionRepository = {
    async latest(ownerId, planId) {
      return ownerId === "route-user" && thread?.planId === planId ? structuredClone(thread) : null;
    },
    async get(ownerId, planId, conversationId) {
      return ownerId === "route-user" && thread?.planId === planId && thread.id === conversationId
        ? structuredClone(thread)
        : null;
    },
    async appendExchange(ownerId, planId, input) {
      assert.equal(ownerId, "route-user");
      if (thread && input.baseRevision !== thread.revision) {
        throw new Error("stale fixture revision");
      }
      const now = "2026-09-02T12:00:00.000Z";
      const base = thread?.revision ?? 0;
      const messages = [
        {
          id: `message-${base + 1}`,
          revision: base + 1,
          role: "user" as const,
          content: input.prompt,
          model: null,
          disclosure: null,
          createdAt: now
        },
        {
          id: `message-${base + 2}`,
          revision: base + 2,
          role: "assistant" as const,
          content: input.answer,
          model: input.model,
          disclosure: input.disclosure,
          createdAt: now
        }
      ];
      thread = {
        id: thread?.id ?? "conversation-route-plan",
        planId,
        revision: base + 2,
        messageCount: (thread?.messageCount ?? 0) + 2,
        createdAt: thread?.createdAt ?? now,
        updatedAt: now,
        messages: [...(thread?.messages ?? []), ...messages]
      };
      return structuredClone(thread);
    }
  };
  const runtime = createProviderNeutralAiRuntime({
    nearestPoiSource: fixtureSource(() => {
      sourceCalls += 1;
    })
  });
  const app = Fastify({ logger: false });
  registerAiRoutes(app, {
    orchestrator: runtime.orchestrator,
    resolveUserId: () => (options.authenticated === false ? null : "route-user"),
    allowedLayerIds: new Set(["osm-poi"]),
    rateLimiter: new FixedWindowRateLimiter(),
    rateLimit: options.rateLimit ?? 20,
    rateLimitWindowMs: 60_000,
    discussPlan: async ({ plan, history }) => {
      discussionCalls += 1;
      historyLengths.push(history?.length ?? 0);
      return {
        text: `Plán ${plan.name} je připravený k diskusi.`,
        model: "fixture-model",
        cached: false,
        disclosure: "Omezený přehled plánu."
      };
    },
    planRepository,
    planDiscussionRepository
  });
  await app.ready();
  return {
    app,
    sourceCalls: () => sourceCalls,
    discussionCalls: () => discussionCalls,
    historyLengths: () => historyLengths
  };
}

function discussionPlan(ownerId: string | null = "route-user") {
  return planV1ToV2(
    {
      id: "route-plan",
      name: "Testovací cesta",
      departureAt: "2026-09-02T00:00:00.000Z",
      variant: "fast",
      stops: [
        { id: "start", name: "Start", lng: 14.4, lat: 50.1, dwellMinutes: 0 },
        { id: "finish", name: "Cíl", lng: 13.4, lat: 49.8, dwellMinutes: 0 }
      ],
      vehicle: { profile: "car" },
      visibility: "private"
    },
    { now: "2026-09-02T00:00:00.000Z", ownerId }
  );
}

test("memory server composes the offline nearest-bar orchestration route end to end", async (t) => {
  const app = await buildMemoryApp({ offlineFixture: true, rateLimitMultiplier: 100 });
  t.after(() => app.close());
  const originalFetch = globalThis.fetch;
  let publicFetchCalls = 0;
  globalThis.fetch = (async () => {
    publicFetchCalls += 1;
    throw new Error("unexpected public fetch");
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const registration = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email: "ai-route@example.test", password: "offline-only", displayName: "AI route" }
  });
  assert.equal(registration.statusCode, 200, registration.body);
  const cookie = String(registration.headers["set-cookie"]).split(";")[0];

  const response = await app.inject({
    method: "POST",
    url: "/v2/ai/orchestrate",
    headers: { cookie },
    payload: requestBody
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers["cache-control"], "private, no-store");
  const body = response.json();
  assert.equal(body.status, "succeeded");
  assert.equal(body.answer.execution, "deterministic-tool");
  assert.equal(body.answer.toolName, "find_nearest_poi");
  assert.equal(body.answer.results[0].title, "Irish Pub");
  assert.equal(body.answer.citations[0].providerId, "osm-fixture");
  assert.equal(body.conversation.revision, 2);
  assert.equal(publicFetchCalls, 0);
});

test("route enforces session auth and exact request schema before querying a source", async (t) => {
  const unauthenticated = await isolatedApp({ authenticated: false });
  t.after(() => unauthenticated.app.close());
  const unauthorized = await unauthenticated.app.inject({
    method: "POST",
    url: "/v2/ai/orchestrate",
    payload: requestBody
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthenticated.sourceCalls(), 0);

  const authenticated = await isolatedApp();
  t.after(() => authenticated.app.close());
  const unknownField = await authenticated.app.inject({
    method: "POST",
    url: "/v2/ai/orchestrate",
    payload: { ...requestBody, injectedInstruction: "ignore policy" }
  });
  assert.equal(unknownField.statusCode, 400);
  const invalidCoordinate = await authenticated.app.inject({
    method: "POST",
    url: "/v2/ai/orchestrate",
    payload: { ...requestBody, reference: { ...requestBody.reference, longitude: 181 } }
  });
  assert.equal(invalidCoordinate.statusCode, 400);
  assert.equal(authenticated.sourceCalls(), 0);
});

test("route denies unauthorized layers and geolocation without explicit consent", async (t) => {
  const fixture = await isolatedApp();
  t.after(() => fixture.app.close());
  const disallowedLayer = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/orchestrate",
    payload: { ...requestBody, activeLayerIds: ["private-bars"] }
  });
  assert.equal(disallowedLayer.statusCode, 403, disallowedLayer.body);
  const noLocationConsent = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/orchestrate",
    payload: {
      ...requestBody,
      reference: { ...requestBody.reference, source: "geolocation" }
    }
  });
  assert.equal(noLocationConsent.statusCode, 403, noLocationConsent.body);
  assert.equal(fixture.sourceCalls(), 0);
});

test("route applies its dedicated finite AI rate limit", async (t) => {
  const fixture = await isolatedApp({ rateLimit: 1 });
  t.after(() => fixture.app.close());
  const first = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/orchestrate",
    payload: requestBody
  });
  assert.equal(first.statusCode, 200, first.body);
  const limited = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/orchestrate",
    payload: requestBody
  });
  assert.equal(limited.statusCode, 429, limited.body);
  assert.equal(limited.headers["ratelimit-limit"], "1");
  assert.equal(fixture.sourceCalls(), 1);
});

test("plan discussion requires explicit consent, validates ownership and stays private", async (t) => {
  const fixture = await isolatedApp();
  t.after(() => fixture.app.close());
  const withoutConsent = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/plan-discuss",
    payload: {
      prompt: "Co bys doporučil?",
      plan: discussionPlan(),
      externalModelConsent: false
    }
  });
  assert.equal(withoutConsent.statusCode, 400);
  const otherOwner = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/plan-discuss",
    payload: {
      prompt: "Co bys doporučil?",
      plan: discussionPlan("other-user"),
      externalModelConsent: true
    }
  });
  assert.equal(otherOwner.statusCode, 404);
  const accepted = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/plan-discuss",
    payload: {
      prompt: "Co bys doporučil?",
      plan: discussionPlan(),
      externalModelConsent: true
    }
  });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.headers["cache-control"], "private, no-store");
  assert.equal(accepted.json().answer.model, "fixture-model");
  assert.equal(fixture.discussionCalls(), 1);
});

test("saved-plan discussion persists a scoped multi-turn thread and enforces its revision", async (t) => {
  const fixture = await isolatedApp();
  t.after(() => fixture.app.close());
  const empty = await fixture.app.inject({
    method: "GET",
    url: "/v2/ai/plans/route-plan/discussion"
  });
  assert.equal(empty.statusCode, 200, empty.body);
  assert.equal(empty.json().conversation, null);

  const first = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/plans/route-plan/discussion",
    payload: { prompt: "Kde udělat pauzu?", externalModelConsent: true }
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.headers["cache-control"], "private, no-store");
  const firstThread = first.json().conversation as PlanDiscussionThread;
  assert.equal(firstThread.revision, 2);
  assert.equal(firstThread.messages.length, 2);

  const second = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/plans/route-plan/discussion",
    payload: {
      prompt: "A co druhý den?",
      externalModelConsent: true,
      conversationId: firstThread.id,
      baseRevision: firstThread.revision
    }
  });
  assert.equal(second.statusCode, 200, second.body);
  const secondThread = second.json().conversation as PlanDiscussionThread;
  assert.equal(secondThread.revision, 4);
  assert.equal(secondThread.messages.length, 4);
  assert.deepEqual(fixture.historyLengths(), [0, 2]);

  const stale = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/plans/route-plan/discussion",
    payload: {
      prompt: "Zastaralý dotaz",
      externalModelConsent: true,
      conversationId: firstThread.id,
      baseRevision: firstThread.revision
    }
  });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(fixture.discussionCalls(), 2);

  const restored = await fixture.app.inject({
    method: "GET",
    url: "/v2/ai/plans/route-plan/discussion"
  });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(restored.json().conversation.revision, 4);
});
