import type { LayerContext } from "@mapos/layer-sdk";
import type maplibregl from "maplibre-gl";
declare global {
  interface Window {
    __maposPerformance?: {
      addLayers(count: number, pins: boolean): void;
      toggleLayer(): void;
      setBasemap(index: number): void;
    };
    __maposLongTasks?: { supported: boolean; durations: number[] };
  }
}
import { writeFileSync, mkdirSync } from "node:fs";
import { expect, test } from "./fixtures/offlineTest";

// Deterministic renderer/engine benchmark, deliberately not a provider latency benchmark.
for (const count of [6, 12])
  test(`bounded map memory with ${count} layers`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Chromium CDP is required for explicit GC");
    test.setTimeout(180_000);
    const buildLabel = process.env.MAPOS_PERF_PRODUCTION === "1" ? "production" : "development";
    const pins = process.env.MAPOS_PERF_RENDERER === "pins";
    const artifactLabel = `${buildLabel}${pins ? "-pins" : ""}`;
    await page.addInitScript(() => {
      const durations: number[] = [];
      const supported = PerformanceObserver.supportedEntryTypes.includes("longtask");
      if (supported) {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            durations.push(entry.duration);
            if (durations.length > 10_000) durations.shift();
          }
        }).observe({ type: "longtask", buffered: true });
      }
      Object.defineProperty(window, "__maposLongTasks", { value: { supported, durations } });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    let requests = 0;
    let payloadBytes = 0;
    await page.route("**/layers/perf-*/features**", async (route) => {
      requests++;
      const url = new URL(route.request().url());
      const id = url.pathname.split("/").at(-2)!;
      const box = url.searchParams.get("bbox")!.split(",").map(Number);
      const body = JSON.stringify({
        type: "FeatureCollection",
        query: { status: "complete" },
        features: Array.from({ length: 400 }, (_, index) => ({
          type: "Feature",
          properties: {
            id: `${id}:${index}`,
            name: `Fixture ${index}`,
            layerId: id
          },
          geometry: {
            type: "Point",
            coordinates: [
              box[0]! + ((box[2]! - box[0]!) * (index % 20)) / 20,
              box[1]! + ((box[3]! - box[1]!) * Math.floor(index / 20)) / 20
            ]
          }
        }))
      });
      payloadBytes += Buffer.byteLength(body);
      await route.fulfill({
        body,
        contentType: "application/json",
        headers: { "cache-control": "no-store" }
      });
    });
    await page.goto("/?layers=cyclosm,openrailwaymap&lng=14.42&lat=50.08&z=12");
    await expect.poll(() => page.evaluate(() => !!window.__maposMap?.isStyleLoaded())).toBe(true);
    if (buildLabel === "production") {
      expect(await page.evaluate(() => !!window.__maposPerformance)).toBe(true);
      expect(
        await page.evaluate(() =>
          performance
            .getEntriesByType("resource")
            .some(
              (entry) =>
                entry.name.includes("/node_modules/.vite/") || entry.name.includes("/@vite/client")
            )
        )
      ).toBe(false);
    }
    await page.evaluate(
      async ({ count, pins }) => {
        if (window.__maposPerformance) {
          window.__maposPerformance.addLayers(count, pins);
          return;
        }
        const registryPath = "/src/layers/index.ts";
        const dataPath = "/src/layers/dataLayer.ts";
        const storePath = "/src/store/mapStore.ts";
        const { registerLayer } = await import(registryPath);
        const { createDataLayer } = await import(dataPath);
        const pinsPath = "/src/layers/pinsLayer.ts";
        const { createPinsLayerHandle } = await import(pinsPath);
        const store = (await import(storePath)).getMapStore();
        for (let i = 0; i < count - 2; i++) {
          const id = `perf-${i}`;
          registerLayer({
            kind: "pins",
            manifest: {
              id,
              name: id,
              description: "Deterministic performance fixture",
              icon: "place",
              color: "#2563eb",
              category: "environment"
            },
            create: (ctx: LayerContext<maplibregl.Map>) =>
              pins
                ? createPinsLayerHandle(ctx.map, ctx.apiBaseUrl, ctx.layerId, "#2563eb")
                : createDataLayer(ctx.map, ctx.apiBaseUrl, ctx.layerId, { color: "#2563eb" })
          });
          store.toggleLayer(id);
        }
      },
      { count, pins }
    );
    const settle = async () => {
      await expect
        .poll(() =>
          page.evaluate((count) => {
            const map = window.__maposMap;
            return (
              !!map?.isStyleLoaded() &&
              Array.from({ length: count - 2 }, (_, i) => `source-perf-${i}`).every(
                (id) =>
                  !!map.getSource(id) &&
                  map.isSourceLoaded(id) &&
                  map.querySourceFeatures(id).length > 0
              )
            );
          }, count)
        )
        .toBe(true);
    };
    await settle();
    await expect.poll(() => requests).toBeGreaterThanOrEqual(count - 2);
    if (pins)
      expect(
        await page.evaluate(
          (count) =>
            Array.from(
              { length: count - 2 },
              (_, i) => window.__maposMap?.getSource(`source-perf-${i}-lines`) != null
            ).some(Boolean),
          count
        )
      ).toBe(false);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const snapshot = async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      const { metrics } = await cdp.send("Performance.getMetrics");
      const dom = await cdp.send("Memory.getDOMCounters");
      const map = await page.evaluate(() => {
        const map = window.__maposMap!;
        return {
          sources: Object.keys(map.getStyle().sources).length,
          layers: map.getStyle().layers.length,
          listeners: Object.fromEntries(
            Object.entries(
              (map as maplibregl.Map & { _listeners?: Record<string, unknown[]> })._listeners ?? {}
            ).map(([key, list]) => [key, list.length])
          )
        };
      });
      return { heap: metrics.find((m) => m.name === "JSHeapUsedSize")!.value, dom, map };
    };
    const before = await snapshot();
    const traceTimeline = process.env.MAPOS_PERF_TIMELINE === "1";
    if (traceTimeline)
      await cdp.send("Tracing.start", {
        categories: "-*,devtools.timeline",
        transferMode: "ReturnAsStream"
      });
    const profileCpu = process.env.MAPOS_PERF_CPU_PROFILE === "1";
    if (profileCpu) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
      await cdp.send("Profiler.start");
    }
    for (let i = 0; i < 50; i++) {
      // MapLibre returns `this`; never serialize the entire map across the automation bridge.
      await page.evaluate((i) => {
        window.__maposMap!.jumpTo({
          center: [14.42 + (i % 10) * 0.012, 50.08 + Math.floor(i / 10) * 0.006]
        });
      }, i);
      await page.waitForTimeout(350);
      await settle();
    }
    for (let i = 0; i < 30; i++) {
      await page.evaluate(async () => {
        if (window.__maposPerformance) {
          window.__maposPerformance.toggleLayer();
          return;
        }
        const path = "/src/store/mapStore.ts";
        const store = (await import(path)).getMapStore();
        store.toggleLayer("perf-0");
      });
      await page.waitForTimeout(30);
      await page.evaluate(async () => {
        if (window.__maposPerformance) {
          window.__maposPerformance.toggleLayer();
          return;
        }
        const path = "/src/store/mapStore.ts";
        const store = (await import(path)).getMapStore();
        store.toggleLayer("perf-0");
      });
      await settle();
    }
    for (let i = 0; i < 10; i++) {
      await page.evaluate(async (i) => {
        if (window.__maposPerformance) {
          window.__maposPerformance.setBasemap(i);
          return;
        }
        const path = "/src/store/mapStore.ts";
        (await import(path)).getMapStore().setBasemap(i % 2 ? "carto-voyager" : "carto-positron");
      }, i);
      await settle();
    }
    await page.evaluate(() => {
      window.__maposMap!.jumpTo({ center: [14.42, 50.08] });
    });
    await page.waitForTimeout(1000);
    await settle();
    if (traceTimeline) {
      const completed = new Promise<string>((resolve) =>
        cdp.once("Tracing.tracingComplete", (event) => resolve(event.stream!))
      );
      await cdp.send("Tracing.end");
      const stream = await completed;
      const chunks: Buffer[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await cdp.send("IO.read", { handle: stream, size: 1024 * 1024 });
          const buffer = Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8");
          bytes += buffer.length;
          if (bytes > 64 * 1024 * 1024) throw new Error("Timeline trace exceeds 64 MiB budget");
          chunks.push(buffer);
          if (chunk.eof) break;
        }
        mkdirSync("output/performance", { recursive: true });
        writeFileSync(
          `output/performance/map-${count}-${artifactLabel}-timeline.json`,
          Buffer.concat(chunks)
        );
      } finally {
        await cdp.send("IO.close", { handle: stream });
      }
    }
    if (profileCpu) {
      const { profile } = await cdp.send("Profiler.stop");
      mkdirSync("output/performance", { recursive: true });
      writeFileSync(
        `output/performance/map-${count}-${artifactLabel}-layers.cpuprofile`,
        JSON.stringify(profile)
      );
      await cdp.send("Profiler.disable");
    }
    const after = await snapshot();
    const longTasks = await page.evaluate(() => {
      const { supported, durations } = window.__maposLongTasks as {
        supported: boolean;
        durations: number[];
      };
      const sorted = [...durations].sort((a, b) => a - b);
      return {
        supported,
        sampleLimit: 10_000,
        count: sorted.length,
        totalMs: sorted.reduce((sum, value) => sum + value, 0),
        maxMs: sorted.at(-1) ?? 0,
        p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : 0
      };
    });
    const allowance = Math.max(before.heap * 0.15, 25 * 1024 * 1024);
    mkdirSync("output/performance", { recursive: true });
    writeFileSync(
      `output/performance/map-${count}-${artifactLabel}-layers.json`,
      JSON.stringify(
        {
          build: buildLabel,
          renderer: pins ? "clustered-pins" : "circles",
          cpuSampling: profileCpu,
          timelineTracing: traceTimeline,
          profile: "offline fixtures, 400 POIs per data layer plus two real raster lifecycles",
          count,
          pans: 50,
          toggles: 30,
          styles: 10,
          viewport: [1440, 900],
          browser: page.context().browser()!.version(),
          requests,
          payloadBytes,
          before,
          after,
          allowance,
          heapDelta: after.heap - before.heap,
          longTasks,
          limitations:
            "JS heap is renderer main thread only; worker heaps and GPU memory are not measured. No public-provider latency claims."
        },
        null,
        2
      )
    );
    expect(after.heap - before.heap).toBeLessThanOrEqual(allowance);
    expect(after.map.sources).toBe(before.map.sources);
    expect(after.map.layers).toBe(before.map.layers);
    expect(after.map.listeners).toEqual(before.map.listeners);
  });
