import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { legendCompactDescription, legendTextEntries } from "./legendPresentation.js";

describe("accessible legend presentation", () => {
  it("turns numeric color stops into text equivalents with units", () => {
    const legend = {
      type: "numeric" as const,
      unit: "M",
      stops: [
        { value: 1, label: "1", color: "#fecaca" },
        { value: 7, label: "7", color: "#7f1d1d" }
      ]
    };
    assert.deepEqual(legendTextEntries(legend), [
      { label: "1 M", color: "#fecaca" },
      { label: "7 M", color: "#7f1d1d" }
    ]);
    assert.equal(legendCompactDescription(legend), "Jednotka M");
  });

  it("keeps category descriptions available without relying on color", () => {
    const result = legendTextEntries({
      type: "categorical",
      items: [{ label: "Odloženo", description: "Nový termín zatím není znám", color: "orange" }]
    });
    assert.deepEqual(result, [
      { label: "Odloženo — Nový termín zatím není znám", color: "orange" }
    ]);
  });
});
