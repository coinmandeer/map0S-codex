import assert from "node:assert/strict";
import test from "node:test";
import { AiToolRegistry, type AiToolDefinition } from "./toolRegistry.js";

interface SearchInput {
  query: string;
  limit: number;
}

interface SearchOutput {
  ids: string[];
}

function searchTool(
  execute: AiToolDefinition<SearchInput, SearchOutput>["execute"] = async () => ({ ids: ["1"] })
): AiToolDefinition<SearchInput, SearchOutput> {
  return {
    name: "search_locations",
    title: "Hledání míst",
    description: "Najde omezený počet povolených míst.",
    domain: "poi",
    effect: "read",
    inputSchema: { type: "object", required: ["query", "limit"] },
    outputSchema: { type: "object", required: ["ids"] },
    permissionPolicy: {
      id: "locations.read",
      requiresAuthentication: false,
      requiredPermissions: ["locations:read"]
    },
    projectionPolicy: {
      dataClasses: ["public"],
      layerIdPaths: [],
      planIdPaths: [],
      requiresPreciseLocation: false,
      outputFields: ["ids"]
    },
    auditPolicy: {
      eventType: "ai.tool.locations.search",
      redactInputPaths: ["query"],
      redactOutputPaths: ["ids"]
    },
    timeoutMs: 30,
    maxResponseBytes: 200,
    quotaCost: 1,
    parseInput(value) {
      const candidate = value as Partial<SearchInput>;
      if (
        !candidate ||
        typeof candidate.query !== "string" ||
        !candidate.query.trim() ||
        !Number.isInteger(candidate.limit) ||
        candidate.limit! < 1 ||
        candidate.limit! > 10
      ) {
        throw new Error("invalid input");
      }
      return { query: candidate.query.trim(), limit: candidate.limit! };
    },
    parseOutput(value) {
      const candidate = value as Partial<SearchOutput>;
      if (!candidate || !Array.isArray(candidate.ids) || candidate.ids.some((id) => !id)) {
        throw new Error("invalid output");
      }
      return { ids: candidate.ids.map(String) };
    },
    execute
  };
}

const allowed = {
  actor: {
    authenticated: true,
    userId: "user-1",
    permissions: new Set(["locations:read"]),
    entitlementIds: new Set<string>()
  },
  projection: {
    allowedLayerIds: new Set(["public-poi"]),
    allowedPlanIds: new Set(["plan-1"]),
    allowedFeatureFieldsByLayer: new Map([["public-poi", new Set(["title"])]]),
    allowedDataClasses: new Set(["public"] as const),
    allowPreciseLocation: true
  }
};

test("registry describes schemas and invokes a bounded authorized read tool", async () => {
  const traces: unknown[] = [];
  const registry = new AiToolRegistry({ onTrace: (trace) => traces.push(trace) });
  registry.register(searchTool());
  assert.equal(registry.describe()[0]?.effect, "read");
  assert.equal(registry.describe()[0]?.permissionPolicy.id, "locations.read");
  const outcome = await registry.invoke<SearchOutput>(
    "search_locations",
    { query: "Praha", limit: 3 },
    allowed
  );
  assert.equal(outcome.status, "succeeded");
  if (outcome.status === "succeeded") assert.deepEqual(outcome.value, { ids: ["1"] });
  assert.equal(traces.length, 1);
  assert.doesNotMatch(JSON.stringify(traces), /Praha|user-1|locations:read/);
  assert.equal((traces[0] as { redacted?: boolean }).redacted, true);
});

test("unknown, invalid and unauthorized calls fail before the handler", async () => {
  let calls = 0;
  const registry = new AiToolRegistry();
  registry.register(
    searchTool(async () => {
      calls += 1;
      return { ids: [] };
    })
  );
  assert.equal((await registry.invoke("missing", {}, allowed)).status, "unknown-tool");
  assert.equal(
    (await registry.invoke("search_locations", { query: "", limit: 999 }, allowed)).status,
    "invalid-input"
  );
  assert.equal(
    (
      await registry.invoke(
        "search_locations",
        { query: "Praha", limit: 3 },
        { ...allowed, actor: { ...allowed.actor, permissions: new Set<string>() } }
      )
    ).status,
    "policy-denied"
  );
  assert.equal(calls, 0);
});

test("descriptors are defensive snapshots and cannot weaken invocation policy", async () => {
  const registry = new AiToolRegistry();
  registry.register(searchTool());
  const descriptor = registry.describe()[0]!;
  (descriptor.permissionPolicy.requiredPermissions as string[]).length = 0;
  (descriptor.projectionPolicy.dataClasses as string[]).length = 0;
  assert.equal(
    (
      await registry.invoke(
        "search_locations",
        { query: "Praha", limit: 3 },
        { ...allowed, actor: { ...allowed.actor, permissions: new Set<string>() } }
      )
    ).status,
    "policy-denied"
  );
});

test("tool timeout, abort and oversized output have distinct safe results", async () => {
  const slow = new AiToolRegistry();
  slow.register(
    searchTool(
      (_input, context) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ ids: [] }), 100);
          context.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(context.signal.reason);
            },
            { once: true }
          );
        })
    )
  );
  assert.equal(
    (await slow.invoke("search_locations", { query: "Praha", limit: 3 }, allowed)).status,
    "timeout"
  );

  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (
      await slow.invoke(
        "search_locations",
        { query: "Praha", limit: 3 },
        { ...allowed, signal: controller.signal }
      )
    ).status,
    "aborted"
  );

  const huge = new AiToolRegistry();
  huge.register(searchTool(async () => ({ ids: ["x".repeat(500)] })));
  assert.equal(
    (await huge.invoke("search_locations", { query: "Praha", limit: 3 }, allowed)).status,
    "invalid-output"
  );
});

test("registry enforces its timeout when a handler ignores AbortSignal forever", async () => {
  const registry = new AiToolRegistry();
  registry.register(searchTool(async () => new Promise<never>(() => undefined)));
  const startedAt = Date.now();
  assert.equal(
    (await registry.invoke("search_locations", { query: "Praha", limit: 3 }, allowed)).status,
    "timeout"
  );
  assert.ok(Date.now() - startedAt < 250, "registry timeout must not wait for handler settlement");
});

test("a handler rejection after the registry timeout is safely observed", async () => {
  let rejectedLate = false;
  const registry = new AiToolRegistry();
  registry.register(
    searchTool(
      async () =>
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => {
            rejectedLate = true;
            reject(new Error("late fixture rejection"));
          }, 60);
        })
    )
  );
  assert.equal(
    (await registry.invoke("search_locations", { query: "Praha", limit: 3 }, allowed)).status,
    "timeout"
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(rejectedLate, true);
});

test("quota cost above the invocation budget is refused", async () => {
  const registry = new AiToolRegistry({ maxQuotaPerInvocation: 0 });
  registry.register(searchTool());
  assert.equal(
    (await registry.invoke("search_locations", { query: "Praha", limit: 3 }, allowed)).status,
    "rate-limited"
  );
});
