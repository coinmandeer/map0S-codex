import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/summarize-map-timeline.mjs <timeline.json>");
const trace = JSON.parse(readFileSync(path, "utf8"));
const threads = new Map(
  trace.traceEvents
    .filter((event) => event.name === "thread_name")
    .map((event) => [`${event.pid}:${event.tid}`, event.args.name])
);
const totals = new Map();
for (const event of trace.traceEvents) {
  if (event.ph !== "X" || !(event.dur > 0)) continue;
  const thread = threads.get(`${event.pid}:${event.tid}`) ?? `${event.pid}:${event.tid}`;
  const key = `${thread}:${event.name}`;
  const row = totals.get(key) ?? { thread, event: event.name, count: 0, inclusiveMs: 0, maxMs: 0 };
  row.count++;
  row.inclusiveMs += event.dur / 1000;
  row.maxMs = Math.max(row.maxMs, event.dur / 1000);
  totals.set(key, row);
}
console.log(
  JSON.stringify(
    {
      path,
      caveat:
        "Inclusive event durations overlap; do not sum them as total CPU time. Trace adds overhead; no public-provider latency claim.",
      top: [...totals.values()].sort((a, b) => b.inclusiveMs - a.inclusiveMs).slice(0, 50)
    },
    null,
    2
  )
);
