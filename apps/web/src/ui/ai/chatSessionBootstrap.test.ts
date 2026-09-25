import assert from "node:assert/strict";
import test from "node:test";
import { ChatSession } from "./chatSession.js";

for (const initialOwner of [null, "persisted-guest"]) {
  test(`${initialOwner ?? "anonymous"} bootstrap preserves a running question; account changes abort it`, () => {
    const session = new ChatSession();
    session.set("conversationId", "first-question");
    const controller = new AbortController();
    session.running.current = controller;
    session.setOwner(initialOwner);
    session.setOwner(initialOwner); // StrictMode/bootstrap repeats the same result.
    assert.equal(session.state.conversationId, "first-question");
    assert.equal(controller.signal.aborted, false);
    session.setOwner("another-account");
    assert.equal(controller.signal.aborted, true);
    assert.equal(session.state.conversationId, null);
    session.set("conversationId", "private-question");
    session.setOwner(null);
    assert.equal(session.state.conversationId, null);
  });
}
