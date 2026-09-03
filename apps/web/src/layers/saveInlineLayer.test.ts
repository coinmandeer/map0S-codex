import assert from "node:assert/strict";
import test from "node:test";
import { MAPOS_LAYER_SDK_RANGE, type LayerManifestV2 } from "@mapos/layer-sdk";
import { saveInlineLayerAsUserLayer } from "./saveInlineLayer";

function manifest(): LayerManifestV2 {
  return {
    schema: "mapos.layer-manifest",
    schemaVersion: "2.0.0",
    sdkRange: MAPOS_LAYER_SDK_RANGE,
    id: "ai-kempy-abc",
    name: "AI: Kempy u vody",
    description: "Návrh vrstvy z odpovědi asistenta.",
    icon: "auto_awesome",
    color: "#7C4DFF",
    category: "user",
    modes: ["discover"],
    geometryKinds: ["Point"],
    renderer: { type: "symbols", style: { iconByCategory: true }, zIndex: 620 },
    source: {
      type: "inline",
      inline: {
        generatedAt: "2026-09-02T10:00:00.000Z",
        provenance: {
          kind: "ai",
          model: "glm-5.3-flash",
          prompt: "kempy u vody",
          createdAt: "2026-09-02T10:00:00.000Z",
          sourceIds: ["osm"]
        },
        features: [
          {
            id: "osm:1",
            title: "Kemp U Řeky",
            longitude: 13.379,
            latitude: 49.749,
            category: "stay.camp_site",
            sourceId: "osm"
          },
          {
            id: "osm:2",
            title: "Kemp Na Kopci",
            longitude: 13.4,
            latitude: 49.76,
            sourceId: "osm"
          }
        ]
      }
    },
    queryPolicy: { strategy: "manual" },
    attribution: [{ label: "OpenStreetMap", requiredOnMap: true, requiredOnExport: true }],
    capabilities: ["query", "export"]
  };
}

function stubFetch(handler: (url: string, body: unknown) => Response) {
  const calls: { url: string; body: unknown }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    return handler(url, body);
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });

test("a saved AI layer keeps its provenance on every pin", async (t) => {
  const stub = stubFetch((url) =>
    url.endsWith("/user-layers") ? json({ layer: { id: "layer-1" } }) : json({ pin: { id: "p" } })
  );
  t.after(stub.restore);

  const result = await saveInlineLayerAsUserLayer(manifest());
  assert.deepEqual(result, { layerId: "layer-1", saved: 2, failed: 0 });

  const pins = stub.calls.filter((call) => call.url.includes("/pins"));
  assert.equal(pins.length, 2);
  const first = pins[0]!.body as { name: string; properties: Record<string, unknown> };
  assert.equal(first.name, "Kemp U Řeky");
  assert.deepEqual(first.properties.provenance, manifest().source.inline!.provenance);
  assert.equal(first.properties.sourceId, "osm");
});

test("a point the server refuses is reported, not counted as saved", async (t) => {
  let pinCalls = 0;
  const stub = stubFetch((url) => {
    if (url.endsWith("/user-layers")) return json({ layer: { id: "layer-1" } });
    pinCalls += 1;
    return pinCalls === 1 ? json({ pin: { id: "p" } }) : json({ message: "nope" }, 400);
  });
  t.after(stub.restore);

  const result = await saveInlineLayerAsUserLayer(manifest());
  assert.deepEqual(result, { layerId: "layer-1", saved: 1, failed: 1 });
});

test("an unauthenticated save fails before any pin is written", async (t) => {
  const stub = stubFetch(() => json({ message: "Unauthorized" }, 401));
  t.after(stub.restore);

  await assert.rejects(() => saveInlineLayerAsUserLayer(manifest()), /Unauthorized/);
  assert.equal(stub.calls.filter((call) => call.url.includes("/pins")).length, 0);
});
