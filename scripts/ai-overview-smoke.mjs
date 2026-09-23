// Explicit, no-model public smoke. Credentials stay in memory and are never printed.
// MAPOS_SMOKE_TARGETS may supply a JSON array of canonical public targets.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const base = process.env.MAPOS_SMOKE_BASE_URL ?? "https://mapos.promptstudio3000.com/api";
const origin = new URL(base).origin;
const targets = JSON.parse(
  process.env.MAPOS_SMOKE_TARGETS ??
    JSON.stringify([
      { type: "poi", layerId: "osm-poi", featureId: "osm:node:12328539094" },
      { type: "coordinate", lng: 1.23, lat: 41.12 }
    ])
);
const guest = await fetch(`${base}/auth/guest`, { method: "POST", headers: { origin } });
assert(guest.ok, `guest HTTP ${guest.status}`);
await guest.json();
const cookie = guest.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");
assert(cookie, "guest cookie missing");
const headers = { origin, cookie, "content-type": "application/json" };
const results = [];
let finalSnapshot;
for (const target of targets) {
  const runs = [];
  for (let i = 0; i < 6; i++) {
    const start = performance.now();
    const response = await fetch(`${base}/v2/ai/overview`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        target,
        language: "cs",
        web: false,
        consent: { externalModel: false }
      }),
      signal: AbortSignal.timeout(30000)
    });
    assert(response.ok, `overview HTTP ${response.status}`);
    let buffer = "",
      firstFactsMs,
      eventCount = 0,
      bodyBytes = 0,
      last;
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      bodyBytes += Buffer.byteLength(chunk);
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        last = JSON.parse(data);
        eventCount++;
        if (
          firstFactsMs === undefined &&
          last.snapshot.sections.some((section) => section.claims.length)
        )
          firstFactsMs = performance.now() - start;
      }
    }
    assert(
      last && ["complete", "partial", "insufficient_evidence"].includes(last.type),
      "terminal event missing"
    );
    const ids = new Set(last.snapshot.sources.map((source) => source.id));
    for (const section of last.snapshot.sections)
      for (const claim of section.claims)
        assert(
          claim.evidenceIds.length && claim.evidenceIds.every((id) => ids.has(id)),
          "unknown citation"
        );
    if (i === 0 && target.type === "poi")
      assert(
        last.snapshot.mapRefs.some((ref) => ref.featureId === target.featureId),
        "canonical map reference missing"
      );
    finalSnapshot = last.snapshot;
    runs.push({
      firstFactsMs,
      completeMs: performance.now() - start,
      eventCount,
      decodedBodyBytes: bodyBytes,
      status: last.type,
      sourceCount: last.snapshot.sources.length,
      limitations: last.snapshot.limitations
    });
  }
  const warm = runs
    .slice(1)
    .map((run) => run.firstFactsMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  results.push({
    target,
    runs,
    warmP95Ms: warm[Math.ceil(warm.length * 0.95) - 1],
    sampleSize: warm.length
  });
}
// Save only a server-owned completed snapshot, then prove another account cannot read it.
const saved = await fetch(`${base}/v2/ai/overview/snapshots`, {
  method: "POST",
  headers,
  body: JSON.stringify({ fingerprint: finalSnapshot.scopeFingerprint })
});
assert(saved.ok, `snapshot save HTTP ${saved.status}`);
const { id } = await saved.json();
const own = await fetch(`${base}/v2/ai/overview/snapshots/${id}`, { headers });
assert(own.ok, "owner cannot read saved snapshot");
const other = await fetch(`${base}/auth/guest`, { method: "POST", headers: { origin } });
await other.json();
const otherCookie = other.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");
const denied = await fetch(`${base}/v2/ai/overview/snapshots/${id}`, {
  headers: { origin, cookie: otherCookie }
});
assert.equal(denied.status, 404, "snapshot leaked across accounts");
for (const sessionCookie of [cookie, otherCookie]) {
  const deletion = await fetch(`${base}/v2/me`, {
    method: "DELETE",
    headers: { ...headers, cookie: sessionCookie },
    body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT" })
  });
  assert(deletion.ok, "smoke guest cleanup failed");
  assert.equal((await deletion.json()).status, "deleted");
}
console.log(
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      base,
      modelConsent: false,
      web: false,
      note: "Five warm samples per target; decoded SSE bytes are not network transfer bytes. Timings include public HTTPS from the recorded client.",
      results,
      snapshotOwnerIsolation: true,
      guestAccountsRemoved: 2
    },
    null,
    2
  )
);
