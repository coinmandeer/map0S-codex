import assert from "node:assert/strict";
import test from "node:test";
import { CharacterController, shouldIgnoreGameKeyEvent } from "./characterController";

const START = { latitude: 50, longitude: 14 };

test("keyboard, touch and accessible inputs use the same movement contract", () => {
  for (const source of ["keyboard", "touch", "accessible"] as const) {
    const controller = new CharacterController(START, 10);
    controller.setAnchorMode("free-roam");
    controller.setMovementVector(source, { x: 1, y: 0 });
    const snapshot = controller.step(1000, 0, false);
    assert.equal(snapshot.activeInput, source);
    assert.ok(snapshot.gamePosition.longitude > START.longitude);
    assert.equal(snapshot.physicalPosition, null);
  }
});

test("GPS keeps physical and game positions distinct until locked", () => {
  const controller = new CharacterController(START);
  const fix = { latitude: 50.1, longitude: 14.2 };
  controller.applyGpsFix(fix, 8);
  assert.deepEqual(controller.snapshot.physicalPosition, fix);
  assert.deepEqual(controller.snapshot.gamePosition, START);

  controller.setAnchorMode("locked-to-gps");
  assert.deepEqual(controller.snapshot.gamePosition, fix);
  controller.applyGpsFix({ latitude: 50.2, longitude: 14.3 }, 4);
  assert.deepEqual(controller.snapshot.gamePosition, { latitude: 50.2, longitude: 14.3 });
  assert.equal(controller.snapshot.gpsAccuracyM, 4);
});

test("GPS exposes the raw fix but filters movement below its accuracy noise", () => {
  const controller = new CharacterController(START);
  controller.setAnchorMode("locked-to-gps");
  controller.applyGpsFix(START, 12);
  const tinyJitter = { latitude: START.latitude + 0.000005, longitude: START.longitude };
  controller.applyGpsFix(tinyJitter, 12);

  assert.deepEqual(controller.snapshot.physicalPosition, tinyJitter);
  assert.deepEqual(controller.snapshot.gamePosition, START);
  assert.equal(controller.snapshot.moving, false);

  const realMove = { latitude: START.latitude + 0.00005, longitude: START.longitude };
  controller.applyGpsFix(realMove, 12);
  assert.deepEqual(controller.snapshot.gamePosition, realMove);
  assert.equal(controller.snapshot.moving, true);
});

test("tap-to-move advances toward a target and supports explicit cancellation", () => {
  const controller = new CharacterController(START, 20);
  controller.setAnchorMode("free-roam");
  controller.setTapTarget({ latitude: 50, longitude: 14.001 });
  const moved = controller.step(100, 0);
  assert.equal(moved.activeInput, "tap");
  assert.ok(moved.gamePosition.longitude > START.longitude);
  controller.cancelMovement();
  assert.equal(controller.snapshot.tapTarget, null);
  assert.equal(controller.snapshot.moving, false);
});

test("manual movement cancels a tap target", () => {
  const controller = new CharacterController(START);
  controller.setAnchorMode("free-roam");
  controller.setTapTarget({ latitude: 50.001, longitude: 14 });
  controller.setMovementVector("touch", { x: 0, y: -1 });
  assert.equal(controller.snapshot.tapTarget, null);
  assert.equal(controller.step(100, 0).activeInput, "touch");
});

test("game keys are ignored while form controls own focus", () => {
  assert.equal(
    shouldIgnoreGameKeyEvent({
      target: { tagName: "INPUT", isContentEditable: false } as HTMLElement
    }),
    true
  );
  assert.equal(
    shouldIgnoreGameKeyEvent({
      target: { tagName: "DIV", isContentEditable: false } as HTMLElement
    }),
    false
  );
  assert.equal(shouldIgnoreGameKeyEvent({ defaultPrevented: true }), true);
});
