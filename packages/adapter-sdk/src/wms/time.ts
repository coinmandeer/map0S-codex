import type { SourceSublayer } from "../contract.js";

const LIMIT = 256;
function instant(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value.slice(0, 10)
    ? ms
    : null;
}

/** A bounded selector for discrete and fixed-duration domains. Calendar months, continuous
 * ranges and moving `current` endpoints need a different UI; do not approximate them. */
export function wmsTimeChoices(
  time: SourceSublayer["time"]
): { values: string[]; truncated: boolean; defaultValue: string } | null {
  if (!time || time.units.toLowerCase() !== "iso8601") return null;
  const values = new Map<number, string>();
  const defaultMs = instant(time.default ?? "");
  let advertisedDefault: string | undefined;
  let truncated = false;
  for (const token of time.values.split(",").map((value) => value.trim())) {
    const date = instant(token);
    if (date !== null) {
      values.set(date, token);
      if (date === defaultMs) advertisedDefault = token;
    } else {
      const [start, end, period, extra] = token.split("/");
      const first = instant(start ?? ""),
        last = instant(end ?? "");
      const duration = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
        period ?? ""
      );
      if (extra || first === null || last === null || !duration || last < first) return null;
      const step =
        (Number(duration[1] ?? 0) * 86400 +
          Number(duration[2] ?? 0) * 3600 +
          Number(duration[3] ?? 0) * 60 +
          Number(duration[4] ?? 0)) *
        1000;
      if (!Number.isSafeInteger(step) || step < 1) return null;
      if (
        defaultMs !== null &&
        defaultMs >= first &&
        defaultMs <= last &&
        (defaultMs - first) % step === 0
      ) {
        advertisedDefault = time.default;
      }
      const count = Math.floor((last - first) / step) + 1;
      truncated ||= count > LIMIT;
      for (let index = Math.max(0, count - LIMIT); index < count; index++) {
        const ms = first + index * step;
        const iso = new Date(ms).toISOString();
        values.set(ms, start!.length === 10 && step % 86400000 === 0 ? iso.slice(0, 10) : iso);
      }
    }
    // Bound memory even for many disjoint ranges or a long explicit list.
    if (values.size > LIMIT) {
      truncated = true;
      for (const key of [...values.keys()].sort((a, b) => a - b).slice(0, values.size - LIMIT))
        values.delete(key);
    }
  }
  // A service may deliberately default to an older edition. Keep that valid edition rather
  // than silently changing its meaning just because the recent selector window is bounded.
  if (defaultMs !== null && advertisedDefault && !values.has(defaultMs)) {
    values.set(defaultMs, advertisedDefault);
    if (values.size > LIMIT) {
      const oldestOther = [...values.keys()]
        .sort((a, b) => a - b)
        .find((key) => key !== defaultMs)!;
      values.delete(oldestOther);
    }
  }
  const sorted = [...values.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
  if (!sorted.length) return null;
  const defaultValue =
    defaultMs === null ? sorted.at(-1)! : (values.get(defaultMs) ?? sorted.at(-1)!);
  return { values: sorted, truncated, defaultValue };
}
