import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MapPickerSession } from "../search/mapPicker.js";
import {
  createShellState,
  hasDismissibleSurface,
  shellReducer,
  type ShellState
} from "./shellState.js";

function closedShell(): ShellState {
  return createShellState({
    mode: "planning",
    leftContext: { type: "closed" },
    legacySheet: null
  });
}

const pickerSession: MapPickerSession = {
  version: 1,
  id: "picker-shell-test",
  caller: { id: "planning-stop", label: "Vybrat zastávku", context: "planning" },
  cancelPolicy: "restore-original-view",
  originalView: { center: { lat: 49.7475, lng: 13.3775 }, zoom: 12 },
  candidate: { lat: 49.75, lng: 13.38 },
  createdAt: 1,
  updatedAt: 1
};

describe("shell surface reducer", () => {
  it("keeps the left context and exactly one right utility independently", () => {
    let state = shellReducer(closedShell(), { type: "open-left" });
    state = shellReducer(state, { type: "open-right", utility: { type: "layers" } });

    assert.deepEqual(state.leftContext, { type: "mode", mode: "planning" });
    assert.deepEqual(state.rightUtility, { type: "layers" });

    state = shellReducer(state, { type: "open-right", utility: { type: "settings" } });
    assert.deepEqual(state.rightUtility, { type: "settings" });
    assert.equal(state.legacySheet, "settings");

    state = shellReducer(state, { type: "open-right", utility: { type: "basemaps" } });
    assert.deepEqual(state.rightUtility, { type: "basemaps" });
    assert.equal(state.legacySheet, "tiles", "the legacy bridge keeps the compatible sheet id");
  });

  it("lets Layers remain behind a modal but closes legacy utilities that share its slot", () => {
    let state = shellReducer(closedShell(), {
      type: "open-right",
      utility: { type: "layers" }
    });
    state = shellReducer(state, { type: "open-modal", sheet: "auth" });
    assert.deepEqual(state.rightUtility, { type: "layers" });
    assert.deepEqual(state.modal, { type: "legacy", sheet: "auth" });

    state = shellReducer(state, { type: "open-right", utility: { type: "settings" } });
    assert.deepEqual(state.rightUtility, { type: "settings" });
    assert.deepEqual(state.modal, { type: "closed" });
  });

  it("walks one surface snapshot at a time and closes the final context", () => {
    let state = shellReducer(closedShell(), { type: "open-left" });
    state = shellReducer(state, { type: "open-right", utility: { type: "layers" } });
    state = shellReducer(state, { type: "open-modal", sheet: "auth" });

    state = shellReducer(state, { type: "back" });
    assert.deepEqual(state.modal, { type: "closed" });
    assert.deepEqual(state.rightUtility, { type: "layers" });

    state = shellReducer(state, { type: "back" });
    assert.deepEqual(state.rightUtility, { type: "closed" });
    assert.deepEqual(state.leftContext, { type: "mode", mode: "planning" });

    state = shellReducer(state, { type: "back" });
    assert.deepEqual(state.leftContext, { type: "closed" });
    assert.equal(hasDismissibleSurface(state), false);
  });

  it("keeps MapPicker callbacks out of state and updates its data without adding history", () => {
    let state = shellReducer(closedShell(), {
      type: "start-map-picker",
      session: pickerSession
    });
    const historyLength = state.history.length;
    state = shellReducer(state, {
      type: "update-map-picker",
      session: {
        ...pickerSession,
        candidate: { lat: 50.08, lng: 14.42 },
        updatedAt: 2
      }
    });

    assert.equal(state.history.length, historyLength);
    assert.doesNotThrow(() => structuredClone(state));
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state);

    state = shellReducer(state, { type: "back" });
    assert.deepEqual(state.mapPicker, { type: "closed" });
  });

  it("orders footer registrations deterministically and updates them by id", () => {
    let state = shellReducer(closedShell(), {
      type: "register-footer",
      contribution: { id: "status", kind: "status", priority: 10 }
    });
    state = shellReducer(state, {
      type: "register-footer",
      contribution: { id: "route", kind: "route", priority: 50 }
    });
    state = shellReducer(state, {
      type: "register-footer",
      contribution: { id: "timeline", kind: "timeline", priority: 50 }
    });
    state = shellReducer(state, {
      type: "register-footer",
      contribution: { id: "status", kind: "status", priority: 100 }
    });

    assert.deepEqual(
      state.footerContributions.map(({ id }) => id),
      ["status", "route", "timeline"]
    );

    state = shellReducer(state, { type: "unregister-footer", id: "route" });
    assert.deepEqual(
      state.footerContributions.map(({ id }) => id),
      ["status", "timeline"]
    );
    assert.equal(hasDismissibleSurface(state), false, "footer content is not a back surface");
  });

  it("normalizes external legacy sheet state without duplicating utilities", () => {
    let state = shellReducer(closedShell(), {
      type: "source-sync",
      mode: "planning",
      leftContext: { type: "mode", mode: "planning" },
      legacySheet: "tiles"
    });
    assert.deepEqual(state.rightUtility, { type: "basemaps" });

    state = shellReducer(state, {
      type: "source-sync",
      mode: "planning",
      leftContext: state.leftContext,
      legacySheet: "wizard"
    });
    assert.deepEqual(state.rightUtility, { type: "closed" });
    assert.deepEqual(state.modal, { type: "legacy", sheet: "wizard" });
  });
});
