import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { ViemEoaSiweVerifier } from "./viemSiweVerifier.js";

test("Viem SIWE verifier accepts only the exact EIP-191 message signed by the address", async () => {
  const account = privateKeyToAccount(
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  );
  const message = "mapos.example SIWE fixture";
  const signature = await account.signMessage({ message });
  const verifier = new ViemEoaSiweVerifier();

  assert.equal(
    await verifier.verify({ address: account.address, chainId: 8453, message, signature }),
    true
  );
  assert.equal(
    await verifier.verify({
      address: account.address,
      chainId: 8453,
      message: `${message} changed`,
      signature
    }),
    false
  );
  assert.equal(
    await verifier.verify({ address: account.address, chainId: 8453, message, signature: "0x00" }),
    false
  );
});
