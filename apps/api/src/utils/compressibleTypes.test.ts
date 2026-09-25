import assert from "node:assert/strict";
import test from "node:test";
import { COMPRESSIBLE_TYPES } from "./compressibleTypes.js";

test("vector tiles are compressed, event streams never are", () => {
  for (const type of [
    "application/vnd.mapbox-vector-tile",
    "application/x-protobuf",
    "application/json; charset=utf-8",
    "application/geo+json",
    "text/html"
  ])
    assert.ok(COMPRESSIBLE_TYPES.test(type), type);
  for (const type of ["text/event-stream", "image/png", "image/webp"])
    assert.ok(!COMPRESSIBLE_TYPES.test(type), type);
});
