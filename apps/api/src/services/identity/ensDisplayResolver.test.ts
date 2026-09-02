import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import { operationalTelemetry } from "../../observability/operationalTelemetry.js";
import { __setUpstreamTestDependencies, providerCircuitBreaker } from "../../utils/upstream.js";
import {
  TtlWalletDisplayMetadataResolver,
  ViemEnsNameProvider,
  type WalletNameProvider
} from "./ensDisplayResolver.js";
import type { IdentityLink } from "./identityService.js";

const address = "0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1";

function wallet(overrides: Partial<IdentityLink> = {}): IdentityLink {
  return {
    id: "identity-1",
    userId: "user-1",
    type: "wallet",
    provider: "siwe",
    subject: address,
    displayLabel: null,
    simulated: false,
    verifiedAt: "2026-09-01T08:00:00.000Z",
    revokedAt: null,
    createdAt: "2026-09-01T08:00:00.000Z",
    ...overrides
  };
}

test("ENS display metadata is bounded, source-labelled and cached with TTL", async () => {
  let calls = 0;
  let now = new Date("2026-09-01T08:00:00.000Z");
  const provider: WalletNameProvider = {
    id: "ens",
    async resolve(value: Address) {
      calls += 1;
      assert.equal(value, address);
      return "traveller.eth";
    }
  };
  const resolver = new TtlWalletDisplayMetadataResolver(provider, {
    ttlMs: 60_000,
    now: () => now
  });

  const first = await resolver.resolve(wallet());
  assert.deepEqual(first, {
    name: "traveller.eth",
    source: "ens",
    resolvedAt: "2026-09-01T08:00:00.000Z",
    expiresAt: "2026-09-01T08:01:00.000Z"
  });
  assert.deepEqual(await resolver.resolve(wallet()), first);
  assert.equal(calls, 1);

  now = new Date("2026-09-01T08:01:01.000Z");
  await resolver.resolve(wallet());
  assert.equal(calls, 2);
});

test("ENS lookup is display-only, negative-cached and never applies to simulated identities", async () => {
  let calls = 0;
  const provider: WalletNameProvider = {
    id: "ens",
    async resolve() {
      calls += 1;
      return null;
    }
  };
  const resolver = new TtlWalletDisplayMetadataResolver(provider);
  assert.equal(await resolver.resolve(wallet()), null);
  assert.equal(await resolver.resolve(wallet()), null);
  assert.equal(calls, 1);
  assert.equal(await resolver.resolve(wallet({ type: "simulated-wallet", simulated: true })), null);
  assert.equal(await resolver.resolve(wallet({ type: "email" })), null);
  assert.equal(await resolver.resolve(wallet({ revokedAt: "2026-09-01T09:00:00.000Z" })), null);
  assert.equal(calls, 1);
});

test("ENS provider errors and unsafe display names fail closed", async () => {
  const errorProvider: WalletNameProvider = {
    id: "ens",
    async resolve() {
      throw new Error("RPC unavailable");
    }
  };
  assert.equal(await new TtlWalletDisplayMetadataResolver(errorProvider).resolve(wallet()), null);

  const unsafeProvider: WalletNameProvider = {
    id: "ens",
    async resolve() {
      return "bad\nname.eth";
    }
  };
  assert.equal(await new TtlWalletDisplayMetadataResolver(unsafeProvider).resolve(wallet()), null);
});

test("configured ENS RPC uses the shared pinned provider boundary", async () => {
  let dnsCalls = 0;
  let requestCalls = 0;
  operationalTelemetry.clear();
  providerCircuitBreaker.clear();
  __setUpstreamTestDependencies({
    async resolveHost() {
      dnsCalls += 1;
      return ["93.184.216.34"];
    },
    async request() {
      requestCalls += 1;
      throw new Error("simulated transport failure");
    }
  });

  try {
    const provider = new ViemEnsNameProvider("https://rpc.example.test/v1/key");
    await provider.resolve(address).catch(() => null);
    assert.ok(dnsCalls > 0);
    assert.ok(requestCalls > 0);
    assert.ok(
      operationalTelemetry
        .snapshot(providerCircuitBreaker.snapshots())
        .providers.some((metric) => metric.provider === "ens-rpc" && metric.outcome === "error")
    );
  } finally {
    __setUpstreamTestDependencies(null);
    operationalTelemetry.clear();
    providerCircuitBreaker.clear();
  }
});
