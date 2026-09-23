import { readFileSync } from "node:fs";

// Sampling evidence, not an interaction-latency assertion. Inspect the raw .cpuprofile in
// DevTools for call stacks; this table reports exclusive sampled time grouped by function.
const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/summarize-cpu-profile.mjs <file.cpuprofile>");
const profile = JSON.parse(readFileSync(path, "utf8"));
const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
const totals = new Map();
for (let index = 0; index < (profile.samples?.length ?? 0); index++) {
  const frame = nodes.get(profile.samples[index]);
  if (!frame) continue;
  const key = JSON.stringify([
    frame.functionName || "(anonymous)",
    frame.url,
    frame.lineNumber + 1
  ]);
  const previous = totals.get(key) ?? {
    function: frame.functionName || "(anonymous)",
    url: frame.url,
    line: frame.lineNumber + 1,
    sampledMs: 0,
    samples: 0
  };
  previous.sampledMs += (profile.timeDeltas?.[index] ?? 0) / 1000;
  previous.samples++;
  totals.set(key, previous);
}
console.log(
  JSON.stringify(
    {
      path,
      elapsedMs: (profile.endTime - profile.startTime) / 1000,
      caveat:
        "Main-thread sampling only; profiling adds overhead. Exclusive sampled time is not wall-clock interaction latency.",
      top: [...totals.values()].sort((a, b) => b.sampledMs - a.sampledMs).slice(0, 35)
    },
    null,
    2
  )
);
