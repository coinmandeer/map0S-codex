import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEFT_PANEL_DEFAULT_WIDTH,
  LEFT_PANEL_WIDTH_STORAGE_KEY,
  clampLeftPanelWidth,
  leftPanelWidthBounds,
  readLeftPanelWidth,
  writeLeftPanelWidth
} from "./panelWidth.js";

describe("desktop left panel width", () => {
  it("uses the source-grounded min, default and viewport-safe maximum", () => {
    assert.deepEqual(leftPanelWidthBounds(900), { min: 320, max: 414 });
    assert.deepEqual(leftPanelWidthBounds(1024), { min: 320, max: 471 });
    assert.deepEqual(leftPanelWidthBounds(1440), { min: 320, max: 560 });
    assert.equal(clampLeftPanelWidth(100, 1440), 320);
    assert.equal(clampLeftPanelWidth(900, 1440), 560);
    assert.equal(clampLeftPanelWidth(Number.NaN, 1440), LEFT_PANEL_DEFAULT_WIDTH);
  });

  it("loads and persists a numeric per-device preference safely", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };
    assert.equal(readLeftPanelWidth(storage, 1440), LEFT_PANEL_DEFAULT_WIDTH);
    writeLeftPanelWidth(storage, 417.4);
    assert.equal(values.get(LEFT_PANEL_WIDTH_STORAGE_KEY), "417");
    assert.equal(readLeftPanelWidth(storage, 1440), 417);

    values.set(LEFT_PANEL_WIDTH_STORAGE_KEY, "invalid");
    assert.equal(readLeftPanelWidth(storage, 1440), LEFT_PANEL_DEFAULT_WIDTH);
  });
});
