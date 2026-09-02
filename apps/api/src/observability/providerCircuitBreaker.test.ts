import assert from "node:assert/strict";
import test from "node:test";
import { ProviderCircuitBreaker } from "./providerCircuitBreaker.js";

test("provider circuit opens after bounded failures and admits one half-open probe", () => {
  let now = Date.parse("2026-09-01T08:00:00.000Z");
  const circuit = new ProviderCircuitBreaker({
    failureThreshold: 2,
    openMs: 10_000,
    now: () => now
  });
  assert.equal(circuit.tryAcquire("overpass"), true);
  circuit.failure("overpass");
  assert.equal(circuit.tryAcquire("overpass"), true);
  circuit.failure("overpass");
  assert.equal(circuit.tryAcquire("overpass"), false);
  assert.equal(circuit.snapshots()[0]?.state, "open");

  now += 10_001;
  assert.equal(circuit.tryAcquire("overpass"), true);
  assert.equal(circuit.tryAcquire("overpass"), false);
  circuit.success("overpass");
  assert.equal(circuit.tryAcquire("overpass"), true);
  assert.equal(circuit.snapshots()[0]?.state, "closed");
});

test("provider circuit keeps bounded adapter keys and rejects invalid IDs instead of collapsing", () => {
  const circuit = new ProviderCircuitBreaker({ maxProviders: 2 });
  circuit.failure("one");
  circuit.failure("two");
  assert.throws(
    () => circuit.failure("https://secret.example/path?lat=1"),
    /providerId must be a stable lowercase slug/
  );
  const providers = circuit.snapshots().map((entry) => entry.provider);
  assert.deepEqual(providers, ["one", "two"]);
  assert.doesNotMatch(JSON.stringify(providers), /secret|lat=/);
});

test("one provider opening does not affect a second provider", () => {
  const circuit = new ProviderCircuitBreaker({ failureThreshold: 2 });
  circuit.failure("weather-open-meteo");
  circuit.failure("weather-open-meteo");

  assert.equal(circuit.tryAcquire("weather-open-meteo"), false);
  assert.equal(circuit.tryAcquire("routing-osrm"), true);
  assert.deepEqual(
    circuit.snapshots().map(({ provider, state }) => ({ provider, state })),
    [
      { provider: "routing-osrm", state: "closed" },
      { provider: "weather-open-meteo", state: "open" }
    ]
  );
});

test("caller abort releases a half-open probe without adding a provider failure", () => {
  let now = Date.parse("2026-09-01T08:00:00.000Z");
  const circuit = new ProviderCircuitBreaker({
    failureThreshold: 1,
    openMs: 1_000,
    now: () => now
  });
  circuit.failure("provider");
  now += 1_001;
  assert.equal(circuit.tryAcquire("provider"), true);
  circuit.aborted("provider");
  assert.equal(circuit.tryAcquire("provider"), true);
  assert.equal(circuit.snapshots()[0]?.consecutiveFailures, 1);
  assert.equal(circuit.snapshots()[0]?.lastFailureAt, "2026-09-01T08:00:00.000Z");
});
