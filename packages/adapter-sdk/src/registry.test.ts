import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAdapterRegistry,
  detectSource,
  queryParam,
  serviceEndpoint,
  SourceProbeError,
  type AdapterIo,
  type SourceAdapter,
  type SourceProbe
} from "./index.js";

const io: AdapterIo = {
  text: async () => "",
  json: async () => ({})
};

function adapter(
  id: string,
  detect: (url: URL) => number,
  probe?: SourceAdapter["probe"]
): SourceAdapter {
  return {
    id,
    label: id,
    kinds: ["wms"],
    detect,
    probe:
      probe ??
      (async (url) =>
        ({
          adapterId: id,
          kind: "wms",
          delivery: "tiles",
          endpoint: url.toString(),
          title: id,
          sublayers: []
        }) satisfies SourceProbe),
    describe: () => {
      throw new Error("not used in this test");
    }
  };
}

describe("detectSource", () => {
  it("ranks by confidence and breaks ties by registration order", () => {
    const first = adapter("first", () => 0.5);
    const second = adapter("second", () => 0.9);
    const third = adapter("third", () => 0.5);
    assert.deepEqual(
      detectSource("https://example.org/wms", [first, second, third]).map(
        ({ adapter: match, confidence }) => [match.id, confidence]
      ),
      [
        ["second", 0.9],
        ["first", 0.5],
        ["third", 0.5]
      ],
      "a deployment orders its own adapters; ties must not be reordered by id"
    );
  });

  it("drops guesses below the noise floor", () => {
    // Offering a 10% hunch as a candidate spends a request and teaches the user that the
    // detector cannot be trusted.
    assert.deepEqual(detectSource("https://example.org/", [adapter("weak", () => 0.1)]), []);
  });

  it("treats a half-typed URL as no match rather than an error", () => {
    // The wizard calls this on every keystroke, and "https:/" is the normal state of that field.
    assert.deepEqual(detectSource("https:/", [adapter("any", () => 1)]), []);
    assert.deepEqual(detectSource("", [adapter("any", () => 1)]), []);
  });

  it("survives an adapter that throws while sniffing", () => {
    const broken = adapter("broken", () => {
      throw new Error("bad regex");
    });
    const working = adapter("working", () => 0.8);
    assert.deepEqual(
      detectSource("https://example.org/wms", [broken, working]).map(({ adapter: m }) => m.id),
      ["working"]
    );
  });

  it("clamps a misbehaving score instead of letting it win everything", () => {
    const greedy = adapter("greedy", () => 99);
    const honest = adapter("honest", () => 1);
    const nonsense = adapter("nonsense", () => Number.NaN);
    const ranked = detectSource("https://example.org/wms", [greedy, honest, nonsense]);
    assert.deepEqual(
      ranked.map(({ confidence }) => confidence),
      [1, 1]
    );
    assert.deepEqual(
      ranked.map(({ adapter: m }) => m.id),
      ["greedy", "honest"]
    );
  });
});

describe("AdapterRegistry", () => {
  it("refuses a duplicate id rather than silently shadowing an adapter", () => {
    const registry = createAdapterRegistry([adapter("wms", () => 1)]);
    assert.throws(() => registry.register(adapter("wms", () => 1)), /already registered/);
  });

  it("lists adapters by the kinds they declare", () => {
    const pmtiles: SourceAdapter = { ...adapter("pmtiles", () => 1), kinds: ["pmtiles"] };
    const registry = createAdapterRegistry([adapter("wms", () => 1), pmtiles]);
    assert.deepEqual(
      registry.forKind("wms").map(({ id }) => id),
      ["wms"]
    );
    assert.deepEqual(registry.forKind("geojson"), []);
  });

  it("falls back to the next candidate when the best guess turns out to be wrong", async () => {
    // `?f=json` marks an ArcGIS service and is also an ordinary query string, so the ranking is
    // a prediction. One extra request is the difference between adding the layer and refusing a
    // URL that works.
    const attempted: string[] = [];
    const confident = adapter(
      "confident",
      () => 0.9,
      async () => {
        attempted.push("confident");
        throw new SourceProbeError("not actually mine", "https://example.org/");
      }
    );
    const runnerUp = adapter(
      "runner-up",
      () => 0.4,
      async (url) => {
        attempted.push("runner-up");
        return {
          adapterId: "runner-up",
          kind: "wms",
          delivery: "tiles",
          endpoint: url.toString(),
          title: "ok",
          sublayers: []
        };
      }
    );
    const registry = createAdapterRegistry([confident, runnerUp]);
    const probe = await registry.probe("https://example.org/service?f=json", io);
    assert.equal(probe.adapterId, "runner-up");
    assert.deepEqual(attempted, ["confident", "runner-up"]);
  });

  it("reports the last real failure, not a generic one, when every candidate fails", async () => {
    const registry = createAdapterRegistry([
      adapter(
        "a",
        () => 0.9,
        async () => {
          throw new SourceProbeError("server answered with HTML", "https://example.org/");
        }
      )
    ]);
    await assert.rejects(
      registry.probe("https://example.org/wms", io),
      /server answered with HTML/,
      "a message the user can act on beats a message we invented"
    );
  });

  it("says it does not recognise a URL rather than probing at random", async () => {
    const registry = createAdapterRegistry([adapter("a", () => 0)]);
    await assert.rejects(registry.probe("https://example.org/whatever", io), /neumíme rozpoznat/);
  });
});

describe("URL helpers", () => {
  it("reads a query parameter whichever case the service shouted it in", () => {
    const url = new URL("https://example.org/wms?SERVICE=WMS&Request=GetCapabilities");
    assert.equal(queryParam(url, "service"), "WMS");
    assert.equal(queryParam(url, "REQUEST"), "GetCapabilities");
    assert.equal(queryParam(url, "layers"), null);
  });

  it("normalises two URLs for the same endpoint to one string", () => {
    const drop = ["service", "request", "version", "f"];
    assert.equal(
      serviceEndpoint(
        new URL("https://example.org/a/WMSServer?SERVICE=WMS&request=GetCapabilities"),
        drop
      ),
      "https://example.org/a/WMSServer"
    );
    assert.equal(
      serviceEndpoint(new URL("https://example.org/a/WMSServer?map=/data/x.map&f=json#frag"), drop),
      "https://example.org/a/WMSServer?map=%2Fdata%2Fx.map",
      "a parameter that selects which service to serve is part of the endpoint and has to stay"
    );
  });
});
