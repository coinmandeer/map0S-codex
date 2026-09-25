import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeArrayBuffer } from "geotiff";
import { skyBrightnessAt, skyAtlasGrid } from "./skyAtlasService.js";

test("atlas samples numerical pixels, preserves zero, and distinguishes nodata and coverage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mapos-atlas-"));
  try {
    const path = join(dir, "fixture.tif");
    const bytes = writeArrayBuffer(new Float32Array([0, 0.25, 4.5, -9999]), {
      width: 2,
      height: 2,
      BitsPerSample: [32],
      SampleFormat: [3],
      SamplesPerPixel: 1,
      GeographicTypeGeoKey: 4326,
      GTModelTypeGeoKey: 2,
      GTRasterTypeGeoKey: 1,
      ModelPixelScale: [1, 1, 0],
      ModelTiepoint: [0, 0, 0, -5, 38, 0],
      GDAL_NODATA: "-9999"
    });
    await writeFile(path, new Uint8Array(bytes));
    assert.equal((await skyBrightnessAt(-4.5, 37.5, undefined, path))?.value, 0);
    const value = await skyBrightnessAt(-3.5, 37.5, undefined, path);
    assert.equal(value?.value, 0.25);
    assert.equal(value?.unit, "mcd/m²");
    assert.equal(await skyBrightnessAt(-3.5, 36.5, undefined, path), null);
    assert.equal(await skyBrightnessAt(0, 0, undefined, path), null);
    const cells = await skyAtlasGrid([-5, 36, -3, 38], undefined, path);
    assert.equal(cells.length, 3);
    assert.deepEqual(cells[0]?.properties.cellBounds, [-5, 37, -4, 38]);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(skyBrightnessAt(-4, 37, controller.signal, path), { name: "AbortError" });
  } finally {
    await rm(dir, { recursive: true });
  }
});
