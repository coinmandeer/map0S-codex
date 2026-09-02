import assert from "node:assert/strict";
import test from "node:test";
import { chooseMapClickTarget } from "./mapClickPriority";

test("POI/pin wins over an overlapping region boundary", () => {
  assert.deepEqual(chooseMapClickTarget([{ id: "poi" }], [{ id: "region" }]), {
    kind: "pin",
    feature: { id: "poi" }
  });
});

test("region remains clickable when no POI is hit", () => {
  assert.deepEqual(chooseMapClickTarget([], [{ id: "region" }]), {
    kind: "region",
    feature: { id: "region" }
  });
  assert.equal(chooseMapClickTarget([], []), null);
});
