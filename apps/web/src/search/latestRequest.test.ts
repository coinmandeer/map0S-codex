import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LatestRequestRunner } from "./latestRequest.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("LatestRequestRunner", () => {
  it("applies a successful current result", async () => {
    const runner = new LatestRequestRunner<number>();
    let applied = 0;
    const result = await runner.run(
      async () => 42,
      (value) => {
        applied = value;
      }
    );
    assert.deepEqual(result, { status: "applied", requestId: 1, value: 42 });
    assert.equal(applied, 42);
    assert.equal(runner.pending, false);
  });

  it("aborts its predecessor and never applies a late response", async () => {
    const runner = new LatestRequestRunner<string>();
    const first = deferred<string>();
    const second = deferred<string>();
    let firstSignal: AbortSignal | undefined;
    const applied: string[] = [];

    const firstRun = runner.run(
      (signal) => {
        firstSignal = signal;
        return first.promise;
      },
      (value) => applied.push(value)
    );
    const secondRun = runner.run(
      () => second.promise,
      (value) => applied.push(value)
    );

    assert.equal(firstSignal?.aborted, true);
    second.resolve("B");
    assert.deepEqual(await secondRun, { status: "applied", requestId: 2, value: "B" });
    first.resolve("A");
    assert.deepEqual(await firstRun, { status: "stale", requestId: 1 });
    assert.deepEqual(applied, ["B"]);
  });

  it("returns cancelled when the active executor observes AbortSignal", async () => {
    const runner = new LatestRequestRunner<string>();
    const run = runner.run(
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            {
              once: true
            }
          );
        })
    );
    assert.equal(runner.cancel("closed"), true);
    assert.deepEqual(await run, { status: "cancelled", requestId: 1, reason: "closed" });
    assert.equal(runner.cancel(), false);
  });

  it("suppresses a value even when a cancelled executor ignores its signal", async () => {
    const runner = new LatestRequestRunner<string>();
    const request = deferred<string>();
    let applied = false;
    const run = runner.run(
      () => request.promise,
      () => {
        applied = true;
      }
    );
    runner.cancel("panel-closed");
    request.resolve("late");
    assert.deepEqual(await run, { status: "cancelled", requestId: 1, reason: "panel-closed" });
    assert.equal(applied, false);
  });

  it("propagates a current request or apply error", async () => {
    const requestError = new Error("request failed");
    const requestRunner = new LatestRequestRunner<number>();
    await assert.rejects(
      () => requestRunner.run(async () => Promise.reject(requestError)),
      requestError
    );

    const applyError = new Error("apply failed");
    const applyRunner = new LatestRequestRunner<number>();
    await assert.rejects(
      () =>
        applyRunner.run(
          async () => 1,
          () => {
            throw applyError;
          }
        ),
      applyError
    );
  });

  it("disposes idempotently and refuses new work", async () => {
    const runner = new LatestRequestRunner<number>();
    runner.dispose();
    runner.dispose();
    assert.deepEqual(await runner.run(async () => 1), {
      status: "cancelled",
      requestId: 0,
      reason: "disposed"
    });
  });
});
