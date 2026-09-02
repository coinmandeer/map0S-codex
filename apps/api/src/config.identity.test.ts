import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveEnsRpcUrl,
  resolveOperationsToken,
  resolveRateLimitSecret,
  resolveSiweChainIds,
  resolveSiweOrigin
} from "./config.js";

test("SIWE production origin is explicit and normalized", () => {
  assert.equal(
    resolveSiweOrigin("https://mapos.example", true, "production"),
    "https://mapos.example"
  );
  assert.throws(() => resolveSiweOrigin(undefined, true, "production"), /PUBLIC_ORIGIN/);
  assert.equal(resolveSiweOrigin(undefined, false, "production"), "https://disabled.mapos.invalid");
  assert.throws(() => resolveSiweOrigin("https://mapos.example/path", true), /bare HTTP/);
});

test("SIWE allowed chains default to Ethereum and current Base and reject malformed lists", () => {
  assert.deepEqual([...resolveSiweChainIds(undefined)], [1, 8453]);
  assert.deepEqual([...resolveSiweChainIds("8453,1,8453")], [8453, 1]);
  assert.throws(() => resolveSiweChainIds("8453,not-a-chain"), /positive integer/);
  assert.throws(() => resolveSiweChainIds("0"), /positive integer/);
});

test("ENS enrichment has no implicit RPC and accepts only explicit safe transport URLs", () => {
  assert.equal(resolveEnsRpcUrl(undefined), undefined);
  assert.equal(resolveEnsRpcUrl("https://rpc.example/v1/key"), "https://rpc.example/v1/key");
  assert.throws(() => resolveEnsRpcUrl("http://localhost:8545"), /HTTPS/);
  assert.throws(() => resolveEnsRpcUrl("http://rpc.example"), /HTTPS/);
  assert.throws(() => resolveEnsRpcUrl("https://name:secret@rpc.example"), /credentials/);
});

test("operations telemetry is disabled by default and production tokens have useful entropy", () => {
  assert.equal(resolveOperationsToken(undefined, "production"), undefined);
  assert.equal(resolveOperationsToken("a".repeat(32), "production"), "a".repeat(32));
  assert.throws(() => resolveOperationsToken("short", "production"), /32/);
  assert.throws(() => resolveOperationsToken(`${"a".repeat(31)} `, "production"), /32/);
});

test("distributed abuse controls require a non-default production HMAC secret", () => {
  assert.equal(
    resolveRateLimitSecret(undefined, "development"),
    "local-development-rate-limit-secret"
  );
  assert.throws(() => resolveRateLimitSecret(undefined, "production"), /required/);
  assert.equal(resolveRateLimitSecret("r".repeat(32), "production"), "r".repeat(32));
  assert.throws(() => resolveRateLimitSecret("too-short", "production"), /32/);
});
