import assert from "node:assert/strict";
import { test } from "node:test";
import type { InjectedEthereumProvider } from "./linkedIdentity";
import {
  injectedWalletConnector,
  mobileWalletsAvailable,
  networkName,
  readWalletChainState,
  shortAddress,
  walletConnectors,
  walletDisplayName
} from "./wallet";

const ADDRESS = "0x1234567890abcdef1234567890Abcdef12345678";

function provider(
  responses: Record<string, unknown>,
  calls: string[] = []
): InjectedEthereumProvider {
  return {
    async request({ method }) {
      calls.push(method);
      if (!(method in responses)) throw new Error(`unexpected ${method}`);
      const value = responses[method];
      if (value instanceof Error) throw value;
      return value;
    }
  };
}

test("chain state comes from the connected wallet and never opens a prompt", async () => {
  const calls: string[] = [];
  const state = await readWalletChainState(
    provider(
      {
        eth_accounts: [ADDRESS.toLowerCase()],
        eth_chainId: "0x2105",
        // 1.5 ETH.
        eth_getBalance: "0x14d1120d7b160000"
      },
      calls
    ),
    ADDRESS
  );
  assert.deepEqual(state, {
    chainId: 8453,
    networkName: "Base",
    balance: 1.5,
    symbol: "ETH"
  });
  assert.ok(
    !calls.includes("eth_requestAccounts"),
    "reading the panel must not pop the wallet open; that is what eth_accounts is for"
  );
});

test("a locked or unauthorised wallet reports nothing rather than an error", async () => {
  // The ordinary state of a page opened without touching the extension. An error card here
  // would make a working app look broken.
  assert.equal(await readWalletChainState(provider({ eth_accounts: [] }), ADDRESS), null);
  assert.equal(
    await readWalletChainState(provider({ eth_accounts: ["0xdead"] }), ADDRESS),
    null,
    "a different account being connected is not this address being readable"
  );
  assert.equal(
    await readWalletChainState(provider({ eth_accounts: new Error("locked") }), ADDRESS),
    null
  );
});

test("a large balance keeps its whole part", async () => {
  // 12345.678 ETH. Scaling in floating point straight from wei would lose precision before the
  // number was ever rounded for display.
  const state = await readWalletChainState(
    provider({
      eth_accounts: [ADDRESS],
      eth_chainId: "0x1",
      eth_getBalance: `0x${(12_345_678n * 10n ** 15n).toString(16)}`
    }),
    ADDRESS
  );
  assert.equal(state?.balance, 12_345.678);
  assert.equal(state?.networkName, "Ethereum");
});

test("an unknown chain is named by its number instead of guessed at", () => {
  assert.equal(networkName(1), "Ethereum");
  assert.equal(networkName(8453), "Base");
  assert.equal(networkName(424_242), "Síť 424242");
});

test("mobile wallets are reported unavailable without a Reown project ID", () => {
  // AppKit cannot start without one — it fails with APKT008 — so the panel has to say this up
  // front rather than at the moment somebody taps connect.
  assert.equal(mobileWalletsAvailable({}), false);
  assert.equal(mobileWalletsAvailable({ VITE_REOWN_PROJECT_ID: "   " }), false);
  assert.equal(mobileWalletsAvailable({ VITE_REOWN_PROJECT_ID: "abc123" }), true);
});

test("the injected connector explains its own absence", () => {
  assert.deepEqual(
    walletConnectors().map((connector) => connector.id),
    ["injected"],
    "AppKit joins this list once a project ID exists"
  );
  const previous = (globalThis as { ethereum?: unknown }).ethereum;
  try {
    delete (globalThis as { ethereum?: unknown }).ethereum;
    assert.match(String(injectedWalletConnector.unavailableReason()), /peněženka/i);
    (globalThis as { ethereum?: unknown }).ethereum = { request: () => Promise.resolve(null) };
    assert.equal(injectedWalletConnector.unavailableReason(), null);
  } finally {
    if (previous === undefined) delete (globalThis as { ethereum?: unknown }).ethereum;
    else (globalThis as { ethereum?: unknown }).ethereum = previous;
  }
});

test("a wallet is shown by its ENS name when one resolved, otherwise by a checkable address", () => {
  assert.equal(shortAddress(ADDRESS), "0x1234…5678");
  const base = {
    id: "1",
    type: "wallet" as const,
    provider: "eip155",
    subject: ADDRESS,
    displayLabel: null,
    simulated: false,
    verifiedAt: null,
    revokedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z"
  };
  assert.equal(walletDisplayName(base), "0x1234…5678");
  assert.equal(
    walletDisplayName({
      ...base,
      displayMetadata: {
        name: "coinmandeer.eth",
        source: "ens",
        resolvedAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2026-09-02T00:00:00.000Z"
      }
    }),
    "coinmandeer.eth"
  );
});
