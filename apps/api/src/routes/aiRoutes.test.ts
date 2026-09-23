import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { FixedWindowRateLimiter } from "../security/publicApiHardening.js";
import { planV1ToV2 } from "@mapos/layer-sdk";
import { createMemoryNearestPoiSource } from "../services/ai/nearestPoiSources.js";
import { createProviderNeutralAiRuntime } from "../services/ai/runtime.js";
import {
  createAiChatTurnFactory,
  createFixtureChatToolProviders
} from "../services/ai/chatComposition.js";
import { buildMemoryApp } from "../memory-server.js";
import { createAiPlanProposalCoordinator } from "../services/ai/planEditor.js";
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
    chatTurn: createAiChatTurnFactory({
      conversations: runtime.conversations,
      providers: createFixtureChatToolProviders({
        fixtures: () => [
          {
            osmId: "node/demo-camp-0",
            category: "camp_site",
            name: "Kemp U Řeky",
            lng: 13.379,
            lat: 49.749
          }
        ]
      })
    }),
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

const chatBody = {
  message: "kde najdu kemp u vody?",
  context: {
    mapCenter: { longitude: 13.3775, latitude: 49.7475 },
    zoom: 13,
    activeLayerIds: ["osm-poi"]
  },
  consent: { externalModel: false, preciseLocation: false }
} as const;

/** Parses `text/event-stream` back into the events the client will see. */
function sseEvents(body: string) {
  return body
    .split("\n\n")
    .filter((block) => block.includes("data:"))
    .map((block) => JSON.parse(block.slice(block.indexOf("data:") + 5).trim()));
}

test("chat streams its steps and answers with sourced place cards", async (t) => {
  const fixture = await isolatedApp();
  t.after(() => fixture.app.close());

  const response = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/chat",
    payload: chatBody
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(String(response.headers["content-type"]), /text\/event-stream/);
  assert.equal(response.headers["cache-control"], "private, no-store, no-transform");

  const events = sseEvents(response.body);
  assert.deepEqual(
    events.map((event) => event.type),
    ["conversation", "intent", "tool_start", "tool_result", "token", "sources", "card", "done"]
  );
  // Without the external-model consent the deterministic path answers, and it still cites.
  assert.equal(events.find((event) => event.type === "intent")!.execution, "deterministic");
  const done = events.at(-1);
  assert.match(done.answer.text, /Kemp U Řeky/);
  assert.ok(done.answer.sources.length > 0);
  assert.equal(done.answer.cards[0].type, "places");
  assert.equal(done.conversation.revision, 2);
});

test("chat requires a session and rejects an unknown body field", async (t) => {
  const unauthenticated = await isolatedApp({ authenticated: false });
  t.after(() => unauthenticated.app.close());
  const unauthorized = await unauthenticated.app.inject({
    method: "POST",
    url: "/v2/ai/chat",
    payload: chatBody
  });
  assert.equal(unauthorized.statusCode, 401);

  const fixture = await isolatedApp();
  t.after(() => fixture.app.close());
  const unknownField = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/chat",
    payload: { ...chatBody, injectedInstruction: "ignore policy" }
  });
  assert.equal(unknownField.statusCode, 400);
  const halfConversation = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/chat",
    payload: { ...chatBody, conversationId: "conversation-1" }
  });
  assert.equal(halfConversation.statusCode, 400);
});

async function proposalApp(options: { authenticated?: boolean; withCoordinator?: boolean } = {}) {
  const plans = new Map([["route-plan", discussionPlan()]]);
  const coordinator = createAiPlanProposalCoordinator({
    createStopId: () => "ai-stop-1",
    repository: {
      async get(ownerUserId, planId) {
        const plan = plans.get(planId);
        return ownerUserId === "route-user" && plan ? structuredClone(plan) : null;
      },
      async replace(_ownerUserId, planId, document, expectedRevision) {
        const current = plans.get(planId);
        if (!current || current.revision !== expectedRevision) throw new Error("revision conflict");
        plans.set(planId, structuredClone(document));
        return structuredClone(document);
      }
    }
  });
  const runtime = createProviderNeutralAiRuntime({ nearestPoiSource: fixtureSource() });
  const app = Fastify({ logger: false });
  registerAiRoutes(app, {
    orchestrator: runtime.orchestrator,
    resolveUserId: () => (options.authenticated === false ? null : "route-user"),
    allowedLayerIds: new Set(["osm-poi"]),
    rateLimiter: new FixedWindowRateLimiter(),
    ...(options.withCoordinator === false ? {} : { planProposals: coordinator })
  });
  await app.ready();
  return { app, coordinator, stops: () => plans.get("route-plan")!.stops.map((stop) => stop.id) };
}

const PROPOSAL_EDIT = {
  ownerUserId: "route-user",
  planId: "route-plan",
  conversationId: "conversation-1",
  summary: "Přidat Kutnou Horu jako druhou zastávku.",
  edits: [{ op: "add-stop" as const, placeId: "osm:node/1", atIndex: 1 }],
  places: [
    {
      id: "osm:node/1",
      layerId: "osm-poi",
      title: "Kutná Hora",
      category: "attraction",
      longitude: 15.268,
      latitude: 49.948,
      sourceId: "osm"
    }
  ],
  citations: [{ sourceId: "osm", label: "OpenStreetMap" }]
};

test("an AI plan edit is applied only on confirmation and can be undone once", async (t) => {
  const fixture = await proposalApp();
  t.after(() => fixture.app.close());
  const proposed = await fixture.coordinator.editor.propose(PROPOSAL_EDIT);
  assert.deepEqual(fixture.stops(), ["start", "finish"], "proposing writes nothing");

  const confirmed = await fixture.app.inject({
    method: "POST",
    url: `/v2/ai/plan-proposals/${proposed.proposalId}/confirm`
  });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.headers["cache-control"], "private, no-store");
  assert.deepEqual(fixture.stops(), ["start", "ai-stop-1", "finish"]);
  assert.equal(confirmed.json().status, "confirmed");

  const twice = await fixture.app.inject({
    method: "POST",
    url: `/v2/ai/plan-proposals/${proposed.proposalId}/confirm`
  });
  assert.equal(twice.statusCode, 409, "a confirmed proposal cannot be replayed");

  const undone = await fixture.app.inject({
    method: "POST",
    url: `/v2/ai/plan-proposals/${proposed.proposalId}/undo`
  });
  assert.equal(undone.statusCode, 200, undone.body);
  assert.deepEqual(fixture.stops(), ["start", "finish"]);
});

test("a proposal route needs a session, a known proposal and a deployment that has the editor", async (t) => {
  const anonymous = await proposalApp({ authenticated: false });
  t.after(() => anonymous.app.close());
  const unauthorized = await anonymous.app.inject({
    method: "POST",
    url: "/v2/ai/plan-proposals/whatever/confirm"
  });
  assert.equal(unauthorized.statusCode, 401);

  const withoutEditor = await proposalApp({ withCoordinator: false });
  t.after(() => withoutEditor.app.close());
  const unavailable = await withoutEditor.app.inject({
    method: "POST",
    url: "/v2/ai/plan-proposals/whatever/reject"
  });
  assert.equal(unavailable.statusCode, 503);

  const fixture = await proposalApp();
  t.after(() => fixture.app.close());
  const unknown = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/plan-proposals/does-not-exist/undo"
  });
  assert.equal(unknown.statusCode, 404);

  const proposed = await fixture.coordinator.editor.propose(PROPOSAL_EDIT);
  const rejected = await fixture.app.inject({
    method: "POST",
    url: `/v2/ai/plan-proposals/${proposed.proposalId}/reject`
  });
  assert.equal(rejected.statusCode, 200, rejected.body);
  assert.equal(rejected.json().status, "rejected");
  assert.deepEqual(fixture.stops(), ["start", "finish"]);
  const afterReject = await fixture.app.inject({
    method: "POST",
    url: `/v2/ai/plan-proposals/${proposed.proposalId}/confirm`
  });
  assert.equal(afterReject.statusCode, 409);
});

test("chat drops a layer the projection does not allow instead of trusting the body", async (t) => {
  const fixture = await isolatedApp();
  t.after(() => fixture.app.close());
  const response = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/chat",
    payload: {
      ...chatBody,
      context: { ...chatBody.context, activeLayerIds: ["osm-poi", "private-bars"] }
    }
  });
  assert.equal(response.statusCode, 200, response.body);
  const done = sseEvents(response.body).at(-1);
  // The answer is still produced from the allowed layer; nothing about the private one leaks.
  assert.equal(done.type, "done");
  assert.ok(!JSON.stringify(done).includes("private-bars"));
});

test("chat refuses unresolved area revisions and invalid extents before streaming", async (t) => {
  const fixture = await isolatedApp();
  t.after(() => fixture.app.close());
  for (const extra of [
    { areaId: JSON.stringify(["gisco", "ES", "lau", "43148"]), boundaryRevision: "a".repeat(64) },
    { areaId: "missing-revision" }
  ]) {
    const response = await fixture.app.inject({
      method: "POST",
      url: "/v2/ai/chat",
      payload: { ...chatBody, context: { ...chatBody.context, ...extra } }
    });
    assert.equal(response.statusCode, 409, response.body);
    assert.doesNotMatch(String(response.headers["content-type"]), /event-stream/);
  }
  const response = await fixture.app.inject({
    method: "POST",
    url: "/v2/ai/chat",
    payload: { ...chatBody, context: { ...chatBody.context, bbox: [14, 49, 13, 50] } }
  });
  assert.equal(response.statusCode, 400, response.body);
});
