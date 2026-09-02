import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { restoreFocus, type FocusRestoreTarget } from "./focusRestore.js";

describe("shell focus restoration", () => {
  it("returns focus to a trigger that is still connected", () => {
    let received: FocusOptions | undefined;
    const trigger = {
      isConnected: true,
      focus(options?: FocusOptions) {
        received = options;
      }
    } satisfies FocusRestoreTarget;

    restoreFocus(trigger);
    assert.deepEqual(received, { preventScroll: true });
  });

  it("does not focus a trigger removed by a mode transition", () => {
    let calls = 0;
    const trigger = {
      isConnected: false,
      focus() {
        calls += 1;
      }
    } satisfies FocusRestoreTarget;

    restoreFocus(trigger);
    restoreFocus(null);
    assert.equal(calls, 0);
  });
});
