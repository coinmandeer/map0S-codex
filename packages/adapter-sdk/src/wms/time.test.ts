import assert from "node:assert/strict";
import test from "node:test";
import { wmsTimeChoices } from "./time.js";

test("time selector preserves explicit dates and resolves equivalent default timestamps", () => {
  assert.deepEqual(
    wmsTimeChoices({
      units: "ISO8601",
      values: "2026-09-02,2026-09-01",
      default: "2026-09-01T00:00:00Z"
    }),
    {
      values: ["2026-09-01", "2026-09-02"],
      defaultValue: "2026-09-01",
      truncated: false
    }
  );
});
test("fixed intervals are bounded and retain the latest advertised instants without drifting", () => {
  const result = wmsTimeChoices({ units: "ISO8601", values: "2000-01-01/2026-09-01/P1D" })!;
  assert.equal(result.values.length, 256);
  assert.equal(result.truncated, true);
  assert.equal(result.values.at(-1), "2026-09-01");
  assert.equal(result.defaultValue, "2026-09-01");
  assert.deepEqual(
    wmsTimeChoices({ units: "ISO8601", values: "2026-09-01T00:00:00Z/2026-09-01T03:00:00Z/PT90M" })
      ?.values,
    ["2026-09-01T00:00:00.000Z", "2026-09-01T01:30:00.000Z", "2026-09-01T03:00:00.000Z"]
  );
});
test("unsupported or invalid domains do not invent time choices", () => {
  for (const values of [
    "2026-02-31",
    "2026-09-01/current/P1D",
    "2026-01-01/2026-09-01/P1M",
    "2026-09-01/2026-09-02/PT0S",
    "2026-09-02/2026-09-01/P1D",
    "2026-09-01/2026-09-02"
  ]) {
    assert.equal(wmsTimeChoices({ units: "ISO8601", values }), null);
  }
});

test("a valid historical default survives the bounded recent selection", () => {
  const result = wmsTimeChoices({
    units: "ISO8601",
    values: "2000-01-01/2026-09-01/P1D",
    default: "2001-02-03"
  })!;
  assert.equal(result.values.length, 256);
  assert.equal(result.defaultValue, "2001-02-03");
  assert.ok(result.values.includes("2001-02-03"));
  assert.equal(result.values.at(-1), "2026-09-01");
  const invalid = wmsTimeChoices({
    units: "ISO8601",
    values: "2026-09-01/2026-09-05/P2D",
    default: "2026-09-02"
  })!;
  assert.equal(invalid.defaultValue, "2026-09-05");
  assert.equal(invalid.values.includes("2026-09-02"), false);
});
