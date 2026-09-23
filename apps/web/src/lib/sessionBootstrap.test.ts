import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapGuestSession } from "./sessionBootstrap.js";

test("chat waits for the shared identity cookie; Stop detaches without cancelling shell bootstrap", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let respond!: (response: Response) => void;
  globalThis.fetch = async () => {
    calls++;
    return new Promise<Response>((resolve) => {
      respond = resolve;
    });
  };
  try {
    const shell = bootstrapGuestSession();
    const stop = new AbortController();
    const stopped = bootstrapGuestSession(stop.signal);
    const live = bootstrapGuestSession(new AbortController().signal);
    stop.abort();
    await assert.rejects(stopped, { name: "AbortError" });
    assert.equal(calls, 1);
    respond(Response.json({ user: { id: "guest" } }));
    assert.equal((await shell).user.id, "guest");
    assert.equal((await live).user.id, "guest");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
