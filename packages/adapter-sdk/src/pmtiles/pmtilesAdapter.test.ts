import { gzipSync } from "node:zlib";
import assert from "node:assert/strict";
import test from "node:test";
import { validateLayerManifestV2 } from "@mapos/layer-sdk";
import type { AdapterIo } from "../contract.js";
import { pmtilesAdapter } from "./pmtilesAdapter.js";

/**
 * A v3 header, written at the byte offsets the specification fixes. Built here rather than
 * checked in as a binary fixture so the offsets under test are visible next to the assertions —
 * a wrong offset in a hand-written parser reads as plausible data, which is the failure this
 * guards against.
 */
function header(options: {
  tileType: number;
  minZoom: number;
  maxZoom: number;
  bounds?: [number, number, number, number];
  metadata?: Uint8Array;
  metadataOffset?: number;
  internalCompression?: number;
  version?: number;
}): Uint8Array {
  const bytes = new Uint8Array(127);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PMTiles"), 0);
  bytes[7] = options.version ?? 3;
  view.setBigUint64(24, BigInt(options.metadataOffset ?? 127), true);
  view.setBigUint64(32, BigInt(options.metadata?.length ?? 0), true);
  bytes[96] = 1;
  bytes[97] = options.internalCompression ?? 2;
  bytes[98] = 2;
  bytes[99] = options.tileType;
  bytes[100] = options.minZoom;
  bytes[101] = options.maxZoom;
  const [west, south, east, north] = options.bounds ?? [0, 0, 0, 0];
  view.setInt32(102, Math.round(west * 1e7), true);
  view.setInt32(106, Math.round(south * 1e7), true);
  view.setInt32(110, Math.round(east * 1e7), true);
  view.setInt32(114, Math.round(north * 1e7), true);
  return bytes;
}

/** `head` is the only transport a PMTiles archive needs, and it is asked for two ranges: the
 *  header at offset 0, then the metadata block. */
function io(head: Uint8Array, metadata?: Uint8Array): AdapterIo {
  return {
    async text() {
      throw new Error("an archive is not text");
    },
    async json() {
      throw new Error("an archive is not JSON");
    },
    async head(_url, _length, offset) {
      return offset ? (metadata ?? new Uint8Array()) : head;
    }
  };
}

const VECTOR_METADATA = gzipSync(
  Buffer.from(
    JSON.stringify({
      name: "Evropa",
      description: "Vlastní vektorové dlaždice",
      attribution: '<a href="https://openstreetmap.org">© OpenStreetMap</a>',
      vector_layers: [
        { id: "buildings", description: "Obrysy budov" },
        { id: "roads" },
        { description: "bez id, nedá se stylovat" }
      ]
    })
  )
);

test("detects an archive from the path, the scheme, and a signed URL", () => {
  assert.equal(pmtilesAdapter.detect(new URL("https://x.org/tiles/europe.pmtiles")), 1);
  assert.equal(pmtilesAdapter.detect(new URL("pmtiles://https://x.org/a.pmtiles")), 1);
  assert.equal(pmtilesAdapter.detect(new URL("https://x.org/get?key=a.pmtiles&sig=b")), 0.7);
  assert.equal(pmtilesAdapter.detect(new URL("https://x.org/a/MapServer")), 0);
});

test("a raster archive is one layer, with the zoom range and bounds from its header", async () => {
  const probe = await pmtilesAdapter.probe(
    new URL("https://x.org/ortofoto.pmtiles"),
    io(header({ tileType: 2, minZoom: 4, maxZoom: 14, bounds: [12.09, 48.55, 18.86, 51.06] }))
  );
  assert.equal(probe.kind, "pmtiles");
  assert.equal(probe.delivery, "tiles");
  assert.equal(probe.title, "ortofoto");
  assert.equal(probe.extra?.vector, false);
  assert.deepEqual(probe.crs, ["EPSG:3857"]);
  assert.equal(probe.sublayers.length, 1);
  assert.deepEqual(probe.sublayers[0]?.bbox, [12.09, 48.55, 18.86, 51.06]);

  const manifest = pmtilesAdapter.describe({ probe, layerId: "orto", sublayerIds: [] });
  assert.equal(manifest.source.type, "raster-tiles");
  // The `pmtiles://` prefix is what routes this through the registered protocol handler.
  assert.equal(
    manifest.source.type === "raster-tiles" ? manifest.source.tileTemplate : "",
    "pmtiles://https://x.org/ortofoto.pmtiles/{z}/{x}/{y}"
  );
  assert.equal(manifest.queryPolicy?.minZoom, 4);
  assert.equal(manifest.queryPolicy?.maxZoom, 14);
  assert.equal(validateLayerManifestV2(manifest).valid, true);
});

test("a vector archive's layers come from its gzipped metadata", async () => {
  const probe = await pmtilesAdapter.probe(
    new URL("https://x.org/europe.pmtiles"),
    io(header({ tileType: 1, minZoom: 0, maxZoom: 15, metadata: VECTOR_METADATA }), VECTOR_METADATA)
  );
  assert.equal(probe.title, "Evropa");
  assert.equal(probe.extra?.vector, true);
  // The entry without an id is dropped: a source layer that cannot be named cannot be styled.
  assert.deepEqual(
    probe.sublayers.map((sublayer) => sublayer.id),
    ["buildings", "roads"]
  );
  // TileJSON attribution is HTML; the map renders its own markup.
  assert.deepEqual(probe.attribution, [{ label: "© OpenStreetMap" }]);

  const manifest = pmtilesAdapter.describe({
    probe,
    layerId: "eu",
    sublayerIds: ["buildings"]
  });
  assert.equal(manifest.source.type, "vector-tiles");
  assert.deepEqual(manifest.geometryKinds, ["VectorTile"]);
  assert.deepEqual(manifest.renderer.style?.["sourceLayers"], ["buildings"]);
  assert.equal(validateLayerManifestV2(manifest).valid, true);
});

test("unreadable metadata leaves a usable raster layer instead of failing the probe", async () => {
  const probe = await pmtilesAdapter.probe(
    new URL("https://x.org/a.pmtiles"),
    // Brotli internally: nothing here can decompress it, and nothing here needs to.
    io(
      header({
        tileType: 2,
        minZoom: 0,
        maxZoom: 9,
        metadata: VECTOR_METADATA,
        internalCompression: 3
      }),
      VECTOR_METADATA
    )
  );
  assert.equal(probe.title, "a");
  assert.equal(probe.sublayers.length, 1);
});

test("a file that is not an archive, and a v2 archive, are both refused clearly", async () => {
  await assert.rejects(
    pmtilesAdapter.probe(new URL("https://x.org/a.pmtiles"), io(new Uint8Array(127))),
    /není archiv PMTiles/
  );
  await assert.rejects(
    pmtilesAdapter.probe(
      new URL("https://x.org/a.pmtiles"),
      io(header({ tileType: 1, minZoom: 0, maxZoom: 9, version: 2 }))
    ),
    /verze 2/
  );
  await assert.rejects(
    pmtilesAdapter.probe(new URL("https://x.org/a.pmtiles"), io(new Uint8Array(4))),
    /kratší/
  );
});

test("a transport without range requests says so rather than reading a truncated archive", async () => {
  await assert.rejects(
    pmtilesAdapter.probe(new URL("https://x.org/a.pmtiles"), {
      async text() {
        return "";
      },
      async json() {
        return {};
      }
    }),
    /rozsahové dotazy/
  );
});

test("a degenerate bounds field is treated as absent, not as covering nothing", async () => {
  const probe = await pmtilesAdapter.probe(
    new URL("https://x.org/a.pmtiles"),
    io(header({ tileType: 2, minZoom: 0, maxZoom: 9, bounds: [10, 10, 10, 10] }))
  );
  assert.equal(probe.sublayers[0]?.bbox, undefined);
});
