import assert from "node:assert/strict";
import { test } from "node:test";
import { pinImageId } from "../map/pinIcons";
import { pinIconSizeExpression } from "./pinsLayer";

test("personal pins are larger than ordinary POI at every configured zoom stop", () => {
  const ordinary = pinIconSizeExpression(false) as unknown[];
  const personal = pinIconSizeExpression(true) as unknown[];
  for (const index of [4, 6, 8, 10]) {
    assert.ok(Number(personal[index]) > Number(ordinary[index]));
  }
});

test("known personal categories use their symbol and unknown categories have a stable fallback", () => {
  assert.equal(pinImageId("viewpoint"), "pin-viewpoint");
  assert.equal(pinImageId("quiet_spot"), "pin-default");
  assert.equal(pinImageId(undefined), "pin-default");
});
