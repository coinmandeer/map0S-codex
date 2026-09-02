import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSoftKeyboardOpen } from "./useVisualViewportLayout";

describe("visual viewport keyboard inference", () => {
  it("opens only for a material viewport loss while an editable control owns focus", () => {
    assert.equal(
      isSoftKeyboardOpen({ layoutHeight: 844, visualHeight: 510, focusedEditable: true }),
      true
    );
    assert.equal(
      isSoftKeyboardOpen({ layoutHeight: 844, visualHeight: 510, focusedEditable: false }),
      false
    );
    assert.equal(
      isSoftKeyboardOpen({ layoutHeight: 844, visualHeight: 760, focusedEditable: true }),
      false
    );
  });
});
