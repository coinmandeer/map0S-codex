import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  injectedEthereum,
  linkInjectedWallet,
  type InjectedEthereumProvider
} from "./linkedIdentity.js";

const address = "0x1234567890abcdef1234567890abcdef12345678";
const message = "mapos.example wants you to sign in\nNonce: SERVER123";
const signature = `0x${"ab".repeat(65)}`;

describe("injected wallet identity flow", () => {
  it("signs only the exact server challenge and verifies it before returning identity", async () => {
    const walletCalls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const postCalls: Array<{ path: string; body: unknown }> = [];
    const provider: InjectedEthereumProvider = {
      async request(input) {
        walletCalls.push(input);
        if (input.method === "eth_requestAccounts") return [address];
        if (input.method === "eth_chainId") return "0x2105";
        if (input.method === "personal_sign") return signature;
        throw new Error("unexpected method");
      }
    };
    const identity = await linkInjectedWallet(provider, async <T>(path: string, body?: unknown) => {
      postCalls.push({ path, body });
      if (path.endsWith("challenge")) {
        return { challenge: { id: "challenge-1", message, address, chainId: 8453 } } as T;
      }
      return {
        identity: {
          id: "identity-1",
          type: "wallet",
          provider: "siwe",
          subject: address,
          displayLabel: null,
          simulated: false,
          verifiedAt: "2026-09-01T00:00:00.000Z",
          revokedAt: null,
          createdAt: "2026-09-01T00:00:00.000Z"
        }
      } as T;
    });

    assert.equal(identity.id, "identity-1");
    assert.deepEqual(
      walletCalls.map((call) => call.method),
      ["eth_requestAccounts", "eth_chainId", "personal_sign"]
    );
    assert.deepEqual(walletCalls[2]?.params, [message, address]);
    assert.deepEqual(postCalls[1]?.body, {
      challengeId: "challenge-1",
      message,
      signature
    });
  });

  it("does not ask for a signature when the challenge changes address or chain", async () => {
    const methods: string[] = [];
    const provider: InjectedEthereumProvider = {
      async request({ method }) {
        methods.push(method);
        if (method === "eth_requestAccounts") return [address];
        if (method === "eth_chainId") return "0x2105";
        throw new Error("signature must not be requested");
      }
    };
    await assert.rejects(
      linkInjectedWallet(
        provider,
        async <T>() =>
          ({
            challenge: {
              id: "challenge-1",
              message,
              address: "0x0000000000000000000000000000000000000001",
              chainId: 8453
            }
          }) as T
      ),
      /neplatnou výzvu/
    );
    assert.deepEqual(methods, ["eth_requestAccounts", "eth_chainId"]);
  });

  it("detects only providers with a request function", () => {
    assert.equal(injectedEthereum({}), null);
    assert.equal(injectedEthereum({ ethereum: {} }), null);
    assert.ok(injectedEthereum({ ethereum: { request: async () => [] } }));
  });
});
