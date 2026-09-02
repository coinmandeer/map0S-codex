import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { LayerManifestV2 } from "@mapos/layer-sdk";
import { operationalTelemetry } from "../observability/operationalTelemetry.js";
import { providerCircuitBreaker } from "../utils/upstream.js";
import {
  DeclarativeHttpLayerService,
  isPublicNetworkAddress
} from "./declarativeHttpLayerService.js";

function manifest(endpoint = "https://data.example.test/pois"): LayerManifestV2 {
  return {
    schema: "mapos.layer-manifest",
    schemaVersion: "2.0.0",
    sdkRange: "^2.0.0",
    id: "partner.parks",
    name: "Partner parks",
    description: "Reviewed declarative fixture",
    category: "community",
    geometryKinds: ["Point"],
    renderer: { type: "symbols" },
    source: {
      type: "declarative-http",
      endpoint,
      method: "GET",
      requiresServerProxy: true,
      query: { bounds: "bbox", take: "limit", kind: "filter:category" },
      mapping: {
        itemsPath: "payload.rows",
        idPath: "id",
        titlePath: "label",
        categoryPath: "kind",
        longitudePath: "location.lng",
        latitudePath: "location.lat",
        nextCursorPath: "payload.next"
      },
      timeoutMs: 200,
      maxResponseBytes: 2_048
    },
    queryPolicy: { strategy: "viewport", maxResultsPerViewport: 20 },
    attribution: [{ label: "Partner open data", license: "CC-BY-4.0" }],
    capabilities: ["query"]
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
}

const query = {
  bbox: [14, 49, 15, 51] as [number, number, number, number],
  filters: { category: "park" },
  limit: 1
};

describe("declarative HTTP layer boundary", () => {
  beforeEach(() => {
    operationalTelemetry.clear();
    providerCircuitBreaker.clear();
  });

  it("maps reviewed JSON deterministically with bounded query parameters", async () => {
    let requested = "";
    const service = new DeclarativeHttpLayerService(
      [{ manifest: manifest(), allowedHosts: ["data.example.test"] }],
      {
        resolveHost: async () => ["93.184.216.34"],
        now: () => new Date("2026-09-01T10:00:00.000Z"),
        request: async (input, _init, addresses) => {
          requested = String(input);
          assert.deepEqual(addresses, ["93.184.216.34"]);
          return jsonResponse({
            payload: {
              rows: [
                { id: "p1", label: "Park one", kind: "park", location: { lng: 14.4, lat: 50.1 } },
                { id: "p2", label: "Park two", kind: "park", location: { lng: 14.5, lat: 50.2 } }
              ],
              next: "cursor-2"
            }
          });
        }
      }
    );
    const result = await service.features("partner.parks", query);
    const url = new URL(requested);
    assert.equal(url.searchParams.get("bounds"), "14,49,15,51");
    assert.equal(url.searchParams.get("take"), "1");
    assert.equal(url.searchParams.get("kind"), "park");
    assert.equal(result.data.features.length, 1);
    assert.equal(result.data.features[0]?.properties.title, "Park one");
    assert.equal(result.meta.nextCursor, "cursor-2");
    assert.equal(result.data.features[0]?.sources[0]?.license, "CC-BY-4.0");
    assert.equal(
      operationalTelemetry.snapshot().providers.find((entry) => entry.provider === "partner.parks")
        ?.outcome,
      "success"
    );
  });

  it("rejects localhost, literal/private DNS targets and revalidates redirects", async () => {
    assert.equal(isPublicNetworkAddress("127.0.0.1"), false);
    assert.equal(isPublicNetworkAddress("10.0.0.2"), false);
    assert.equal(isPublicNetworkAddress("192.88.99.1"), false);
    assert.equal(isPublicNetworkAddress("198.51.100.4"), false);
    assert.equal(isPublicNetworkAddress("::ffff:7f00:1"), false);
    assert.equal(isPublicNetworkAddress("::ffff:127.0.0.1"), false);
    assert.equal(isPublicNetworkAddress("fc00::1"), false);
    assert.equal(isPublicNetworkAddress("93.184.216.34"), true);
    assert.equal(isPublicNetworkAddress("2606:4700:4700::1111"), true);

    const privateDns = new DeclarativeHttpLayerService(
      [{ manifest: manifest(), allowedHosts: ["data.example.test"] }],
      {
        resolveHost: async () => ["10.0.0.2"],
        request: async () => jsonResponse({})
      }
    );
    await assert.rejects(() => privateDns.features("partner.parks", query), /private or invalid/);

    const redirect = new DeclarativeHttpLayerService(
      [{ manifest: manifest(), allowedHosts: ["data.example.test"] }],
      {
        resolveHost: async () => ["93.184.216.34"],
        request: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://localhost/admin" }
          })
      }
    );
    await assert.rejects(() => redirect.features("partner.parks", query), /not allowed/);

    const credentialed = new DeclarativeHttpLayerService([
      {
        manifest: manifest("https://user:password@data.example.test/pois"),
        allowedHosts: ["data.example.test"]
      }
    ]);
    await assert.rejects(() => credentialed.features("partner.parks", query), /credential-free/);
  });

  it("enforces streaming response and timeout limits", async () => {
    const oversized = new DeclarativeHttpLayerService(
      [{ manifest: manifest(), allowedHosts: ["data.example.test"] }],
      {
        resolveHost: async () => ["93.184.216.34"],
        request: async () => jsonResponse({ payload: { rows: [], padding: "x".repeat(3_000) } })
      }
    );
    await assert.rejects(() => oversized.features("partner.parks", query), /too large/);

    const slowManifest = manifest();
    slowManifest.source.timeoutMs = 100;
    const timedOut = new DeclarativeHttpLayerService(
      [{ manifest: slowManifest, allowedHosts: ["data.example.test"] }],
      {
        resolveHost: async () => ["93.184.216.34"],
        request: (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true
            });
          })
      }
    );
    await assert.rejects(
      () => timedOut.features("partner.parks", query),
      /timed out or was cancelled/
    );
  });
});
