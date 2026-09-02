import assert from "node:assert/strict";
import test from "node:test";
import { joystickVector } from "./touchControls";

test("joystick vector is normalized and uses screen-up as forward", () => {
  assert.deepEqual(joystickVector({ x: 50, y: 50 }, { x: 50, y: 50 }, 40), { x: 0, y: 0 });
  assert.deepEqual(joystickVector({ x: 50, y: 50 }, { x: 50, y: 10 }, 40), { x: 0, y: 1 });
  assert.deepEqual(joystickVector({ x: 50, y: 50 }, { x: 90, y: 50 }, 40), { x: 1, y: 0 });
  const diagonal = joystickVector({ x: 0, y: 0 }, { x: 100, y: -100 }, 40);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-9);
});
