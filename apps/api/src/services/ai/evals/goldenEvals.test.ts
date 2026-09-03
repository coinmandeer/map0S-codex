import assert from "node:assert/strict";
import test from "node:test";
import {
  AiChatService,
  classifyChatIntent,
  type AiChatEvent,
  type AiChatRequest
} from "../chatService.js";
import { createChatToolRegistry } from "../chatTools.js";
import { AiConversationStore } from "../conversation.js";
import type {
  AiAdapterRequest,
  AiAdapterResult,
  AiModelAdapter,
  AiModelProfile
} from "../contracts.js";
import { AiGateway } from "../gateway.js";
import type { AiModelRuntime } from "../modelRuntime.js";
import { aiModelRuntime } from "../modelRuntime.js";
import { aiPrompt } from "../prompts/index.js";
import type { AiToolActor, AiToolPermissionProjection } from "../toolRegistry.js";
import {
  createEvalChatProviders,
  evalToolArguments,
  loadAiChatEvalCases,
  EVAL_MAP_CENTER,
  type AiChatEvalCase
} from "./index.js";

const CASES = loadAiChatEvalCases();

const actor: AiToolActor = {
  authenticated: true,
  userId: "eval-user",
  permissions: new Set([
    "map:read",
    "layers:read",
    "poi:read",
    "route:read",
    "weather:read",
    "events:read",
    "web:read",
    "saved-places:read"
  ]),
  entitlementIds: new Set()
};

function projectionFor(evalCase: AiChatEvalCase): AiToolPermissionProjection {
  return {
    allowedLayerIds: new Set(["osm-poi", "events"]),
    allowedPlanIds: new Set(evalCase.openPlan ? ["eval-plan"] : []),
    allowedFeatureFieldsByLayer: new Map([["osm-poi", new Set(["name", "category"])]]),
    allowedDataClasses: new Set(["public", "account-private"]),
    allowPreciseLocation: true
  };
}

function requestFor(evalCase: AiChatEvalCase, externalModel: boolean): AiChatRequest {
  return {
    ownerUserId: "eval-user",
    message: evalCase.query,
    messageDataClass: "account-private",
    context: {
      mapCenter: { ...EVAL_MAP_CENTER },
      zoom: 12,
      activeLayerIds: ["osm-poi", "events"],
      ...(evalCase.openPlan ? { planId: "eval-plan", mode: "planning" } : {})
    },
    consent: { externalModel, preciseLocation: true },
    conversation: { mode: "new", scope: { type: "global" } },
    actor,
    projection: projectionFor(evalCase)
  };
}

/** The gateway, cache and byte limits of production with the provider round trip replaced: the
 *  adapter names the tool the case expects and then submits an answer. */
function scriptedRuntime(evalCase: AiChatEvalCase): {
  runtime: AiModelRuntime;
  requests: AiAdapterRequest[];
} {
  const requests: AiAdapterRequest[] = [];
  const tool = evalCase.tools[0]!;
  const adapter: AiModelAdapter = {
    id: "eval-scripted",
    capabilities: { text: true, jsonSchema: false, tools: true, streaming: false, vision: false },
    async run(input) {
      requests.push(input);
      const alreadyRan = (input.history ?? []).some((turn) => turn.role === "tool");
      const call: AiAdapterResult = alreadyRan
        ? {
            text: "",
            finishReason: "tool-call",
            toolCalls: [
              {
                id: "submit",
                name: "submit_answer",
                arguments: { text: "Odpověď z golden evalu.", followUps: ["Zobraz to v mapě"] }
              }
            ]
          }
        : {
            text: "",
            finishReason: "tool-call",
            toolCalls: [
              { id: "call", name: tool, arguments: evalToolArguments(tool, evalCase.query) }
            ]
          };
      return call;
    }
  };
  const profile: AiModelProfile = {
    id: "eval-scripted-fast",
    providerId: "eval-scripted",
    model: "eval-scripted-model",
    capabilities: adapter.capabilities,
    limits: {
      contextTokens: 16_000,
      outputTokens: 2_000,
      maxToolRounds: 4,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768
    },
    privacy: {
      execution: "external",
      allowedDataClasses: ["public", "account-private"],
      retention: "none"
    },
    costPolicy: "economy"
  };
  return {
    runtime: { gateway: new AiGateway([adapter]), enabled: true, profiles: () => [profile] },
    requests
  };
}

function chatService(evalCase: AiChatEvalCase, runtime?: AiModelRuntime): AiChatService {
  const { registry, available } = createChatToolRegistry({
    providers: createEvalChatProviders(),
    mapContext: {
      center: { ...EVAL_MAP_CENTER },
      zoom: 12,
      activeLayerIds: ["osm-poi", "events"]
    }
  });
  return new AiChatService({
    registry,
    conversations: new AiConversationStore(),
    availableTools: available,
    ...(runtime ? { runtime } : {}),
    ...(evalCase.openPlan
      ? {
          planEditor: {
            async propose(input) {
              return {
                proposalId: "eval-proposal",
                planId: input.planId,
                diff: {
                  baseRevision: 1,
                  previewRevision: 2,
                  changedPlanFields: [],
                  addedStopIds: [],
                  removedStopIds: [],
                  movedStopIds: [],
                  updatedStopIds: [],
                  affectedSegmentIds: []
                }
              };
            }
          }
        }
      : {})
  });
}

function collect() {
  const events: AiChatEvent[] = [];
  return { events, emit: (event: AiChatEvent) => void events.push(event) };
}

test("the golden set is the thirty questions §30.9 asks for", () => {
  assert.equal(CASES.length, 30);
  const intents = new Set(CASES.map((entry) => entry.intent));
  // Every branch of the router is exercised; a branch nobody asks about drifts unnoticed.
  for (const intent of [
    "place",
    "question",
    "layer_query",
    "command",
    "plan",
    "edit_plan",
    "layer_create"
  ]) {
    assert.ok(intents.has(intent as never), `no golden question routes to ${intent}`);
  }
});

for (const evalCase of CASES) {
  test(`golden: ${evalCase.id}`, async () => {
    assert.equal(
      classifyChatIntent(evalCase.query),
      evalCase.intent,
      `"${evalCase.query}" is routed to the wrong intent`
    );

    const { runtime, requests } = scriptedRuntime(evalCase);
    const sink = collect();
    const answer = await chatService(evalCase, runtime).run(requestFor(evalCase, true), sink.emit);
    assert.ok(answer, "a golden question is never answered with nothing");

    const offered = new Set((requests[0]?.tools ?? []).map((spec) => spec.name));
    for (const tool of evalCase.tools) {
      assert.ok(offered.has(tool), `${tool} is not offered for this question`);
    }
    assert.ok(offered.has(evalCase.submit), `${evalCase.submit} is not offered for this question`);
    for (const tool of evalCase.forbidden ?? []) {
      assert.ok(!offered.has(tool), `${tool} must not be offered for this question`);
    }

    // The prompt that reached the provider is the versioned file, not a copy in the service. The
    // gateway appends its own injection rule for the source blocks, so this is a prefix check.
    assert.ok(
      requests[0]?.system.startsWith(aiPrompt("ai-chat-turn.v1", { submitTool: "submit_answer" })),
      "the versioned prompt is not what reached the provider"
    );

    const ran = sink.events.find((event) => event.type === "tool_result");
    assert.ok(ran?.type === "tool_result" && ran.tool === evalCase.tools[0]);
    assert.equal(ran.status, "succeeded", `${ran.tool} failed on the fixtures`);

    // Without model consent the same question still gets an answer from the deterministic path.
    const offlineSink = collect();
    const offline = await chatService(evalCase).run(requestFor(evalCase, false), offlineSink.emit);
    assert.ok(offline, "a golden question is never left unanswered offline");
    assert.ok(offline.text.trim().length > 0);
    assert.ok(
      offline.cards.length > 0 || offline.followUps.length > 0,
      "an answer with neither a card nor a next step is a dead end"
    );
  });
}

/**
 * One live question against the configured model. Off by default: it costs money, needs a key and
 * fails for reasons that have nothing to do with this repository.
 */
test(
  "live: the configured model picks a tool from the ones it was offered",
  { skip: process.env.MAPOS_AI_LIVE_EVAL !== "1" },
  async () => {
    const runtime = aiModelRuntime();
    assert.ok(runtime.enabled, "MAPOS_AI_LIVE_EVAL=1 needs a configured AI gateway");
    const evalCase = CASES.find((entry) => entry.id === "place-camp-by-water")!;
    const sink = collect();
    const answer = await chatService(evalCase, runtime).run(requestFor(evalCase, true), sink.emit);
    assert.ok(answer);
    const called = sink.events
      .filter((event) => event.type === "tool_start")
      .map((event) => (event.type === "tool_start" ? event.tool : ""));
    assert.ok(
      called.some((tool) => evalCase.tools.includes(tool)),
      `the model called ${called.join(", ") || "no tool"} instead of ${evalCase.tools.join(", ")}`
    );
  }
);
