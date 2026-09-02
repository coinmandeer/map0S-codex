import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  __resetProviderReadiness,
  checkMapyReadiness,
  getMapyReadiness
} from "./providerReadinessService.js";

afterEach(__resetProviderReadiness);

test("an unconfigured Mapy provider does not touch the database or network", async () => {
  let calls = 0;
  const result = await checkMapyReadiness({
    configured: false,
    checkDatabase: async () => {
      calls += 1;
    },
    checkUpstream: async () => {
      calls += 1;
    },
    now: () => 1_700_000_000_000
  });
  assert.equal(result.status, "unconfigured");
  assert.equal(calls, 0);
});

test("readiness requires both the Mapy cache schema and upstream", async () => {
  const checked: string[] = [];
  const result = await checkMapyReadiness({
    configured: true,
    checkDatabase: async () => {
      checked.push("database");
    },
    checkUpstream: async () => {
      checked.push("upstream");
    },
    now: () => 1_700_000_000_000
  });
  assert.equal(result.status, "ready");
  assert.deepEqual(checked, ["database", "upstream"]);
});

test("a schema failure degrades capability without exposing its error", async () => {
  const result = await checkMapyReadiness({
    configured: true,
    checkDatabase: async () => {
      throw new Error('relation "mapy_cells" does not exist; parameters: [secret]');
    },
    checkUpstream: async () => undefined,
    now: () => 1_700_000_000_000
  });
  assert.equal(result.status, "degraded");
  assert.equal(result.message, "Mapy.com momentálně není dostupné");
  assert.doesNotMatch(JSON.stringify(result), /mapy_cells|secret/);
});

test("simultaneous config requests share one readiness probe", async () => {
  let probes = 0;
  let now = 1_700_000_000_000;
  const dependencies = {
    configured: true,
    checkDatabase: async () => undefined,
    checkUpstream: async () => {
      probes += 1;
      await Promise.resolve();
    },
    now: () => now
  };

  const [first, second] = await Promise.all([
    getMapyReadiness(dependencies),
    getMapyReadiness(dependencies)
  ]);
  assert.equal(first.status, "ready");
  assert.deepEqual(second, first);
  assert.equal(probes, 1);

  now += 1_000;
  await getMapyReadiness(dependencies);
  assert.equal(probes, 1, "ready result should remain cached");
});
