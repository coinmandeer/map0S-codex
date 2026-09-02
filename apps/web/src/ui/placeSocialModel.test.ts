import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maposSocialFailureMessage, maposSocialSummary } from "./placeSocialModel";

describe("MapOS social presentation", () => {
  it("keeps an empty community state distinct from provider content", () => {
    assert.deepEqual(maposSocialSummary([], []), {
      average: null,
      reviews: 0,
      comments: 0,
      empty: true
    });
  });

  it("computes the MapOS-only rating and explicit offline wording", () => {
    const summary = maposSocialSummary(
      [
        { id: "a", rating: 5, body: null },
        { id: "b", rating: 3, body: "ok" }
      ],
      [{ id: "c", body: "hello" }]
    );
    assert.equal(summary.average, "4.0");
    assert.equal(summary.empty, false);
    assert.match(maposSocialFailureMessage(false), /offline/);
  });
});
