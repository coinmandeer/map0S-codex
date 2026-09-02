import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../index.js";
import { LEGACY_INPUT_FREE_GET_ROUTES } from "./publicRouteSchemas.js";

interface ObservedRoute {
  method: string | string[];
  url: string;
  schema?: unknown;
  bodyLimit?: number;
}

function methods(route: ObservedRoute): string[] {
  return (Array.isArray(route.method) ? route.method : [route.method]).map((value) =>
    value.toUpperCase()
  );
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

test("production public-route inventory has bounded Fastify input schemas", async (t) => {
  const routes: ObservedRoute[] = [];
  const app = await buildApp({ logger: false, observeRoute: (route) => routes.push(route) });
  await app.ready();
  t.after(() => app.close());

  assert.ok(
    routes.length >= 100,
    `expected the complete production inventory, got ${routes.length}`
  );
  for (const route of routes.filter((item) => !item.url.startsWith("/internal/"))) {
    const schema = object(route.schema);
    assert.ok(schema.params, `${methods(route).join(",")} ${route.url} has no params schema`);
    assert.ok(
      schema.querystring,
      `${methods(route).join(",")} ${route.url} has no querystring schema`
    );
    if (methods(route).some((method) => !["GET", "HEAD", "OPTIONS"].includes(method))) {
      assert.ok(schema.body, `${methods(route).join(",")} ${route.url} has no body schema`);
      assert.ok(
        Number.isSafeInteger(route.bodyLimit) && route.bodyLimit! > 0,
        `${methods(route).join(",")} ${route.url} has no finite bodyLimit`
      );
    }
  }

  const highRisk = routes.filter((route) =>
    /^(?:\/v2\/(?:routing\/(?:plan|temporal-context)|plans)|\/api\/v2\/(?:auth|me\/identities|me\/aavegotchi)|\/mapy\/|\/weather\/(?:grid|variables))/.test(
      route.url
    )
  );
  assert.ok(highRisk.length >= 20, "high-risk route and generated HEAD inventory is incomplete");
  for (const route of highRisk) {
    const schema = object(route.schema);
    const query = object(schema.querystring);
    assert.equal(
      query.additionalProperties,
      false,
      `${methods(route).join(",")} ${route.url} must use an exact query schema`
    );
  }
});

test("legacy no-input exceptions are explicit, unique GET routes", async (t) => {
  const routes: ObservedRoute[] = [];
  const app = await buildApp({ logger: false, observeRoute: (route) => routes.push(route) });
  await app.ready();
  t.after(() => app.close());

  assert.equal(new Set(LEGACY_INPUT_FREE_GET_ROUTES).size, LEGACY_INPUT_FREE_GET_ROUTES.length);
  for (const url of LEGACY_INPUT_FREE_GET_ROUTES) {
    assert.ok(!url.includes(":"), `${url} is not an input-free path`);
    const get = routes.find((route) => route.url === url && methods(route).includes("GET"));
    assert.ok(get, `${url} is a stale inventory exception`);
    const query = object(object(get.schema).querystring);
    assert.equal(query.maxProperties, 0, `${url} does not reject unexpected query input`);
    assert.equal(query.additionalProperties, false);
  }
});
