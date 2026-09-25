import test from "node:test";
import assert from "node:assert/strict";
import { ChatSession } from "./chatSession";
test("panel subscriptions do not erase conversation; reset aborts and invalidates old generation", () => {
  const session = new ChatSession();
  let updates = 0;
  const off = session.subscribe(() => updates++);
  session.set("conversationId", "one");
  off();
  assert.equal(session.state.conversationId, "one");
  session.running.current = new AbortController();
  const controller = session.running.current;
  const generation = session.generation;
  session.clear();
  assert.equal(controller.signal.aborted, true);
  assert(session.generation > generation);
  assert.equal(session.state.conversationId, null);
  assert.equal(updates, 1);
});
