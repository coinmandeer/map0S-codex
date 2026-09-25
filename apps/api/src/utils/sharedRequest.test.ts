import test from "node:test";
import assert from "node:assert/strict";
import { consumeShared, type SharedRequest } from "./sharedRequest.js";
test("one aborted viewer does not cancel another viewer of the same transport", async () => {
  let complete!: (value: number) => void;
  const entry: SharedRequest<number> = {
    promise: new Promise((r) => (complete = r)),
    controller: new AbortController(),
    consumers: 0,
    settled: false
  };
  const first = new AbortController(),
    second = new AbortController();
  const a = consumeShared(entry, first.signal),
    b = consumeShared(entry, second.signal);
  first.abort();
  await assert.rejects(a);
  assert.equal(entry.controller.signal.aborted, false);
  entry.settled = true;
  complete(7);
  assert.equal(await b, 7);
  assert.equal(entry.consumers, 0);
});
test("last cancelled viewer releases shared transport immediately", async () => {
  const entry: SharedRequest<number> = {
    promise: new Promise(() => {}),
    controller: new AbortController(),
    consumers: 0,
    settled: false
  };
  const signal = new AbortController();
  const waiting = consumeShared(entry, signal.signal);
  signal.abort();
  await assert.rejects(waiting);
  assert.equal(entry.controller.signal.aborted, true);
});
