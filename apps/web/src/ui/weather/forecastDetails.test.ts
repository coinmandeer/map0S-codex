import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detailedHoursForDay,
  forecastDayLabel,
  forecastHourLabel,
  type ForecastHour
} from "./forecastDetails";

const hours: ForecastHour[] = Array.from({ length: 30 }, (_, index) => {
  const day = index < 24 ? "2026-09-02" : "2026-09-03";
  const hour = index < 24 ? index : index - 24;
  return {
    time: `${day}T${String(hour).padStart(2, "0")}:00`,
    temperature: 12 + hour,
    precipitation: hour % 5 === 0 ? 0.4 : 0,
    code: 2
  };
});

describe("daily forecast details", () => {
  it("selects only the requested local forecast day at a deterministic three-hour step", () => {
    assert.deepEqual(
      detailedHoursForDay(hours, "2026-09-02").map(({ time }) => time.slice(11, 16)),
      ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]
    );
    assert.deepEqual(
      detailedHoursForDay(hours, "2026-09-03").map(({ time }) => time.slice(11, 16)),
      ["00:00", "03:00"]
    );
  });

  it("formats bounded Czech day/hour labels and preserves malformed source text", () => {
    assert.match(forecastDayLabel("2026-09-02"), /st/u);
    assert.equal(forecastHourLabel("2026-09-02T09:00"), "09:00");
    assert.equal(forecastHourLabel("unknown"), "unknown");
    assert.equal(forecastDayLabel("unknown"), "unknown");
  });
});
