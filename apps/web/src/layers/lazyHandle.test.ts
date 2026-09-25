import assert from "node:assert/strict";
import test from "node:test";
import type { LayerHandle } from "@mapos/layer-sdk";
import { LazyHandle } from "./lazyHandle";

test("lazy imports await the current update and never replay obsolete viewports", async () => {
  let resolve!: (handle: LayerHandle) => void;
  let updates = 0;
  const result = { type: "FeatureCollection" as const, features: [] };
  const lazy = new LazyHandle(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const controller = new AbortController();
  const old = lazy.update([0, 0, 1, 1], {}, controller.signal);
  const rejected = assert.rejects(old, { name: "AbortError" });
  controller.abort();
  const current = lazy.update([1, 1, 2, 2], {});
  resolve({
    update: async (bbox) => {
      updates++;
      assert.equal(bbox[0], 1);
      return result;
    },
    setVisible() {},
    setOpacity() {},
    detach() {}
  });
  assert.equal(await current, result);
  await rejected;
  assert.equal(updates, 1);
});

test("detaching during import disposes the handle without starting its request", async () => {
  let resolve!: (handle: LayerHandle) => void;
  let detached = 0;
  const lazy = new LazyHandle(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const pending = assert.rejects(lazy.update([0, 0, 1, 1], {}), { name: "AbortError" });
  lazy.detach();
  resolve({
    update: async () => {
      assert.fail("detached update");
    },
    setVisible() {},
    setOpacity() {},
    detach() {
      detached++;
    }
  });
  await pending;
  assert.equal(detached, 1);
});

test("an import failure reaches the engine instead of reporting successful empty data", async () => {
  const lazy = new LazyHandle(async () => {
    throw new Error("chunk unavailable");
  });
  await assert.rejects(lazy.update([0, 0, 1, 1], {}), /chunk unavailable/);
});
