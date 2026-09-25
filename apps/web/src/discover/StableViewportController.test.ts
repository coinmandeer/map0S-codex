import assert from "node:assert/strict";
import test from "node:test";
import type { DiscoverViewport } from "./context";
import {
  stableViewportKey,
  isMeaningfulViewportChange,
  StableViewportController
} from "./StableViewportController";

class FakeScheduler {
  now = 0;
  private nextId = 1;
  private queue = new Map<number, { at: number; callback: () => void }>();

  setTimer = (callback: () => void, delay: number): number => {
    const id = this.nextId++;
    this.queue.set(id, { at: this.now + delay, callback });
    return id;
  };

  clearTimer = (handle: unknown): void => {
    this.queue.delete(handle as number);
  };

  advance(ms: number): void {
    this.now += ms;
    for (const [id, item] of [...this.queue.entries()].sort((a, b) => a[1].at - b[1].at)) {
      if (item.at > this.now) continue;
      this.queue.delete(id);
      item.callback();
    }
  }

  get size(): number {
    return this.queue.size;
  }
}

const viewport: DiscoverViewport = {
  lng: 13.3775,
  lat: 49.7475,
  zoom: 12,
  bbox: [13.2, 49.6, 13.5, 49.9],
  activeLayerIds: ["osm-poi"]
};

test("waits two stable seconds and does not storm on small viewport jitter", async () => {
  const scheduler = new FakeScheduler();
  const requests: DiscoverViewport[] = [];
  const controller = new StableViewportController<string>({
    request: async (input) => {
      requests.push(input);
      return "ready";
    },
    now: () => scheduler.now,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer
  });

  controller.observe(viewport);
  controller.observe({ ...viewport, lng: viewport.lng + 0.0001 });
  assert.equal(scheduler.size, 1);
  scheduler.advance(1_999);
  assert.equal(requests.length, 0);
  scheduler.advance(1);
  await Promise.resolve();
  assert.equal(requests.length, 1);
  assert.equal(controller.snapshot().status, "ready");
});

test("a meaningful move resets the timer and aborts a stale in-flight request", async () => {
  const scheduler = new FakeScheduler();
  const signals: AbortSignal[] = [];
  const releases: Array<(value: string) => void> = [];
  const controller = new StableViewportController<string>({
    request: (_input, signal) => {
      signals.push(signal);
      return new Promise((resolve) => releases.push(resolve));
    },
    now: () => scheduler.now,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer
  });

  controller.observe(viewport);
  scheduler.advance(2_000);
  assert.equal(signals.length, 1);

  const moved = {
    ...viewport,
    lng: 13.7,
    bbox: [13.5, 49.6, 13.8, 49.9] as [number, number, number, number]
  };
  controller.observe(moved);
  assert.equal(signals[0]?.aborted, true);
  assert.equal(controller.snapshot().status, "waiting");
  scheduler.advance(2_000);
  assert.equal(signals.length, 2);
  releases[1]?.("new");
  await Promise.resolve();
  assert.equal(controller.snapshot().data, "new");
  releases[0]?.("old");
  await Promise.resolve();
  assert.equal(controller.snapshot().data, "new");
});

test("an in-flight request is reused inside the same region and zoom cache bucket", async () => {
  const scheduler = new FakeScheduler();
  let requests = 0;
  let release!: (value: string) => void;
  const controller = new StableViewportController<string>({
    request: () => {
      requests += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    now: () => scheduler.now,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer
  });

  void controller.refresh(viewport);
  // The bbox moved enough to be meaningful, but the context centre remains in the same cache
  // bucket. This must not fan out a duplicate request.
  controller.observe({
    ...viewport,
    bbox: [13.23, 49.6, 13.53, 49.9]
  });
  assert.equal(requests, 1);
  assert.equal(scheduler.size, 0);
  release("shared");
  await Promise.resolve();
  assert.equal(controller.snapshot().data, "shared");
});

test("explicit refresh starts immediately and a fresh stable result is cached", async () => {
  const scheduler = new FakeScheduler();
  let requests = 0;
  const controller = new StableViewportController<string>({
    request: async () => `result-${++requests}`,
    now: () => scheduler.now,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer
  });

  await controller.refresh(viewport);
  assert.equal(requests, 1);
  controller.observe({
    ...viewport,
    lng: viewport.lng + 0.1,
    bbox: [13.3, 49.6, 13.6, 49.9]
  });
  scheduler.advance(2_000);
  await Promise.resolve();
  assert.equal(requests, 2);

  controller.observe(viewport);
  assert.equal(controller.snapshot().status, "ready");
  assert.equal(controller.snapshot().data, "result-1");
  assert.equal(scheduler.size, 0);
});

test("meaningful-change policy is based on viewport scale, layers and zoom hierarchy", () => {
  assert.equal(
    isMeaningfulViewportChange(viewport, { ...viewport, lng: viewport.lng + 0.0001 }),
    false
  );
  assert.equal(
    isMeaningfulViewportChange(viewport, { ...viewport, activeLayerIds: ["events"] }),
    true
  );
  assert.equal(isMeaningfulViewportChange(viewport, { ...viewport, zoom: 14 }), true);
});

test("a user-cancelled request returns to neutral state instead of a red error", async () => {
  const controller = new StableViewportController<string>({
    request: async () => {
      const error = new Error("cancelled");
      error.name = "AbortError";
      throw error;
    }
  });

  await controller.refresh(viewport);
  assert.equal(controller.snapshot().status, "idle");
  assert.equal(controller.snapshot().error, null);
});

test("selected areas and editions never share a viewport cache identity", () => {
  const point = { lng: 1, lat: 41, zoom: 10 };
  assert.notEqual(
    stableViewportKey({ ...point, areaId: "municipality", boundaryRevision: "a" }),
    stableViewportKey({ ...point, areaId: "province", boundaryRevision: "a" })
  );
  assert.equal(
    isMeaningfulViewportChange(
      { ...point, areaId: "municipality", boundaryRevision: "a" },
      { ...point, areaId: "municipality", boundaryRevision: "b" }
    ),
    true
  );
});

test("camera movement does not refetch an unchanged selected area", () => {
  const selected = { lng: 1, lat: 41, zoom: 10, areaId: "municipality", boundaryRevision: "a" };
  const moved = { ...selected, lng: 2, lat: 42, zoom: 15 };
  assert.equal(stableViewportKey(selected), stableViewportKey(moved));
  assert.equal(isMeaningfulViewportChange(selected, moved), false);
});
