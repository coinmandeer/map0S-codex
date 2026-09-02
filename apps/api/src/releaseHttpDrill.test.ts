import assert from "node:assert/strict";
import test from "node:test";
import { candidateProxyHeaders } from "./releaseHttpDrill.js";

test("the candidate HTTP drill reproduces the public same-origin proxy boundary", () => {
  assert.deepEqual(candidateProxyHeaders("https://mapos.example"), {
    origin: "https://mapos.example",
    host: "mapos.example",
    "x-forwarded-host": "mapos.example",
    "x-forwarded-proto": "https"
  });
  assert.throws(() => candidateProxyHeaders("http://mapos.example"), /HTTPS public origin/);
  assert.throws(() => candidateProxyHeaders("https://mapos.example/path"), /HTTPS public origin/);
});
