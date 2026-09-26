import assert from "node:assert/strict";
import test from "node:test";
import { areaQuery } from "./areaQuery";

test("an area question is offered again only after the reader moves the map", () => {
  let reruns = 0;
  let notified = 0;
  const off = areaQuery.subscribe(() => notified++);
  areaQuery.markMoved();
  assert.equal(areaQuery.moved(), false, "nothing to offer without a question");

  areaQuery.set({ id: "turn-1", label: "kavárny", rerun: () => reruns++ });
  assert.equal(areaQuery.moved(), false, "the answer's own camera fit is not a move");
  areaQuery.markMoved();
  assert.equal(areaQuery.moved(), true);
  areaQuery.get()?.rerun();
  assert.equal(reruns, 1);

  areaQuery.set({ id: "turn-2", label: "kavárny", rerun: () => reruns++ });
  assert.equal(areaQuery.moved(), false, "a new answer starts over");
  areaQuery.clear("turn-1");
  assert.equal(areaQuery.get()?.id, "turn-2", "a late cleanup never drops a newer question");
  areaQuery.clear("turn-2");
  assert.equal(areaQuery.get(), null);
  assert.ok(notified >= 4);
  off();
});
