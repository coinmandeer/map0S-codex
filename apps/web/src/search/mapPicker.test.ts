import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MapPickerControllerRegistry,
  parseMapPickerSession,
  serializeMapPickerSession,
  type OpenMapPickerInput
} from "./mapPicker.js";

const baseInput: OpenMapPickerInput = {
  caller: { id: "plan-stop", label: "Přidat zastávku", context: "planning" },
  originalView: { center: { lat: 50.08, lng: 14.42 }, zoom: 12, bearing: 4, pitch: 20 },
  candidate: { lat: 50.09, lng: 14.43, label: "Střed mapy" }
};

function registry(onCallbackError?: (error: unknown) => void): MapPickerControllerRegistry {
  return new MapPickerControllerRegistry({
    now: () => 1_000,
    createId: () => "picker-1",
    onCallbackError
  });
}

describe("MapPicker session serialization", () => {
  it("round-trips a normalized data-only session", () => {
    const picker = registry();
    const session = picker.open(baseInput, () => {});
    const serialized = serializeMapPickerSession(session);
    assert.deepEqual(parseMapPickerSession(serialized), session);
    assert.equal(serialized.includes("function"), false);
  });

  it("rejects corrupt, future or unsafe persisted state", () => {
    assert.equal(parseMapPickerSession("not-json"), null);
    assert.equal(parseMapPickerSession({ version: 2 }), null);
    assert.equal(
      parseMapPickerSession({
        version: 1,
        id: "x",
        caller: { id: "x", label: "x" },
        cancelPolicy: "restore-original-view",
        originalView: { center: { lat: 91, lng: 14 }, zoom: 10 },
        createdAt: 1,
        updatedAt: 1
      }),
      null
    );
    assert.throws(() => serializeMapPickerSession({} as never), /Invalid MapPicker session/);
  });
});

describe("MapPickerControllerRegistry", () => {
  it("updates a candidate, confirms it and calls the owner exactly once", () => {
    const picker = registry();
    const outcomes: unknown[] = [];
    const session = picker.open(baseInput, (result) => outcomes.push(result));
    picker.updateCandidate(session.id, { lat: 49.75, lng: 13.38, label: "Nové místo" });

    const result = picker.confirm(session.id);
    assert.deepEqual(result, {
      status: "confirmed",
      sessionId: "picker-1",
      location: { lat: 49.75, lng: 13.38, label: "Nové místo" }
    });
    assert.deepEqual(outcomes, [result]);
    assert.equal(picker.confirm(session.id), null);
    assert.equal(picker.cancel(session.id), null);
    assert.equal(picker.activeSession, null);
  });

  it("cancels safely and returns the original view under the default policy", () => {
    const picker = registry();
    const outcomes: unknown[] = [];
    const session = picker.open(baseInput, (result) => outcomes.push(result));
    const result = picker.cancel(session.id);

    assert.deepEqual(result, {
      status: "cancelled",
      sessionId: "picker-1",
      reason: "user",
      restoreView: baseInput.originalView
    });
    assert.deepEqual(outcomes, [result]);
  });

  it("does not request restoration under keep-current-view policy", () => {
    const picker = registry();
    const session = picker.open({ ...baseInput, cancelPolicy: "keep-current-view" }, () => {});
    assert.deepEqual(picker.cancel(session.id), {
      status: "cancelled",
      sessionId: "picker-1",
      reason: "user"
    });
  });

  it("settles an old owner before replacing the active session", () => {
    let nextId = 0;
    const picker = new MapPickerControllerRegistry({
      now: () => 1,
      createId: () => `picker-${++nextId}`
    });
    const firstOutcomes: unknown[] = [];
    const secondOutcomes: unknown[] = [];
    const first = picker.open(baseInput, (result) => firstOutcomes.push(result));
    const second = picker.open(baseInput, (result) => secondOutcomes.push(result));

    assert.equal(first.id, "picker-1");
    assert.equal(second.id, "picker-2");
    assert.deepEqual(firstOutcomes, [
      {
        status: "cancelled",
        sessionId: "picker-1",
        reason: "superseded",
        restoreView: baseInput.originalView
      }
    ]);
    picker.confirm(second.id);
    assert.equal(secondOutcomes.length, 1);
  });

  it("attaches a restored session to a new callback registry", () => {
    const original = registry();
    const serialized = serializeMapPickerSession(original.open(baseInput, () => {}));
    const restored = registry();
    const outcomes: unknown[] = [];
    const session = restored.attach(serialized, (result) => outcomes.push(result));

    restored.confirm(session.id);
    assert.equal(outcomes.length, 1);
    assert.equal((outcomes[0] as { status: string }).status, "confirmed");
  });

  it("removes controller state before reporting a callback error", () => {
    const errors: unknown[] = [];
    const picker = registry((error) => errors.push(error));
    const expected = new Error("owner failed");
    const session = picker.open(baseInput, () => {
      throw expected;
    });

    assert.doesNotThrow(() => picker.confirm(session.id));
    assert.deepEqual(errors, [expected]);
    assert.equal(picker.cancel(session.id), null);
  });

  it("rejects invalid candidate updates without settling the controller", () => {
    const picker = registry();
    const session = picker.open(baseInput, () => {});
    assert.equal(picker.updateCandidate(session.id, { lat: 100, lng: 14 }), null);
    assert.notEqual(picker.get(session.id), null);
  });

  it("normalizes an invalid injected clock instead of creating corrupt state", () => {
    const picker = new MapPickerControllerRegistry({
      now: () => Number.NaN,
      createId: () => "clock-safe"
    });
    const session = picker.open(baseInput, () => {});
    assert.equal(session.createdAt, 0);
    assert.equal(session.updatedAt, 0);
    assert.doesNotThrow(() => serializeMapPickerSession(session));
  });

  it("disposes active work once and cannot be reopened from its cancellation callback", () => {
    const picker = registry();
    const outcomes: unknown[] = [];
    picker.open(baseInput, (result) => {
      outcomes.push(result);
      assert.throws(() => picker.open(baseInput, () => {}), /disposed/);
    });
    picker.dispose();
    picker.dispose();
    assert.equal(outcomes.length, 1);
    assert.equal((outcomes[0] as { reason: string }).reason, "disposed");
    assert.equal(picker.activeSession, null);
  });
});
