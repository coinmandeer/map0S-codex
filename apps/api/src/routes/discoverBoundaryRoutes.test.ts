import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerDiscoverBoundaryRoutes } from "./discoverBoundaryRoutes.js";
import { ClientError } from "../utils/clientError.js";

test("boundary tiles are independent from guides and validate the tile matrix", async () => {
  const app = Fastify();
  let reads = 0;
  registerDiscoverBoundaryRoutes(app, {
    coverage: async () => [
      { country: "CZ", level: "adm1", count: 14, source: "fixture", edition: "test" }
    ],
    tile: async (level, z, x, y) => {
      reads++;
      assert.deepEqual([level, z, x, y], ["adm1", 4, 8, 5]);
      return new Uint8Array([1, 2, 3]);
    }
  });
  try {
    const meta = await app.inject("/v2/discover/boundaries");
    assert.equal(meta.json().ready, true);
    assert.equal(meta.json().coverage[0].count, 14);
    const tile = await app.inject("/v2/discover/boundaries/adm1/4/8/5.mvt");
    assert.equal(tile.statusCode, 200);
    assert.deepEqual(tile.rawPayload, Buffer.from([1, 2, 3]));
    for (const path of ["nuts1/4/8/5", "adm1/4/16/5", "adm1/15/0/0", "lau/4/1.5/0"]) {
      assert.equal((await app.inject(`/v2/discover/boundaries/${path}.mvt`)).statusCode, 400);
    }
    assert.equal(reads, 1);
  } finally {
    await app.close();
  }
});

test("manifest coverage and immutable tile URLs describe the same retained edition", async () => {
  const app = Fastify();
  const revision = "a".repeat(64);
  registerDiscoverBoundaryRoutes(app, {
    manifest: async () => revision,
    coverage: async (requested) => {
      assert.equal(requested, revision);
      return [{ country: "CZ", level: "adm1", count: 14, source: "fixture", edition: "v1" }];
    },
    tile: async (_level, _z, _x, _y, requested) => {
      if (requested !== revision) throw new ClientError("Boundary edition is unavailable", 404);
      return new Uint8Array([1, 2]);
    }
  });
  try {
    const manifest = (await app.inject("/v2/discover/boundaries")).json();
    assert.equal(manifest.revision, revision);
    assert.ok(manifest.tileTemplate.includes(revision));
    const tile = await app.inject(`/v2/discover/boundaries/${revision}/adm1/4/8/5.mvt`);
    assert.equal(tile.statusCode, 200);
    assert.match(String(tile.headers["cache-control"]), /immutable/);
    assert.equal(
      (await app.inject(`/v2/discover/boundaries/${"b".repeat(64)}/adm1/4/8/5.mvt`)).statusCode,
      404
    );
    assert.equal(
      (await app.inject("/v2/discover/boundaries/invalid/adm1/4/8/5.mvt")).statusCode,
      400
    );
  } finally {
    await app.close();
  }
});
