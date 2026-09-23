import assert from "node:assert/strict";
import test from "node:test";
import { readableLayerColor } from "./layerColor";

/** Repeats the WCAG maths independently of the module, so a wrong formula there cannot make the
 *  assertions below agree with it. */
function contrast(a: string, b: string): number {
  const channels = (hex: string) =>
    [1, 3, 5].map((offset) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  const luminance = (hex: string) => {
    const [r, g, b] = channels(hex);
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("a colour that already reads on the surface is left untouched", () => {
  // #1e4fd8 is the accent, which the token file picked for contrast on white.
  assert.equal(readableLayerColor("#1e4fd8", "light"), "#1e4fd8");
});

test("a pale colour is darkened until it clears 3:1 on white", () => {
  const before = "#0ea5e9";
  assert.ok(contrast(before, "#ffffff") < 3, "fixture stopped being a failing colour");
  const after = readableLayerColor(before, "light");
  assert.notEqual(after, before);
  assert.ok(contrast(after, "#ffffff") >= 3, `${after} still fails on white`);
});

test("a dark colour is lightened until it clears 3:1 on the dark surface", () => {
  const after = readableLayerColor("#1b3a2f", "dark");
  assert.ok(contrast(after, "#1a1d21") >= 3, `${after} still fails on the dark surface`);
});

test("three-digit hex and a missing hash are understood, anything else passes through", () => {
  assert.equal(readableLayerColor("#036", "dark"), readableLayerColor("#003366", "dark"));
  assert.equal(readableLayerColor("036", "dark"), readableLayerColor("#003366", "dark"));
  assert.equal(readableLayerColor("var(--layer-stay)", "light"), "var(--layer-stay)");
});
