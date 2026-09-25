import { promises as fs } from "node:fs";
import path from "node:path";
import { lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { weatherFrames } from "../db/schema.js";
import { safeErrorLogFields } from "../utils/clientError.js";
import { fetchBytes, fetchJson } from "../utils/upstream.js";

const RADAR_DIR = process.env.RADAR_DIR ?? "/data/radar";
const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
const ZOOM_LEVELS = [0, 1, 2, 3, 4, 5];
/** RainViewer palette 7 ("Rainbow SELEX-SI"). The live radar in the browser draws with the same
 *  palette, so scrubbing the timeline back from "now" into archived frames no longer switches
 *  the rain colours mid-animation. Keep in step with `RADAR_COLOR_SCHEME` in the web layer. */
export const RADAR_ARCHIVE_COLOR_SCHEME = 7;
const RETENTION_MS = 24 * 3600_000;
const ARCHIVE_INTERVAL_MS = 15 * 60_000;
const TILE_CONCURRENCY = 10;

export const OWM_LAYERS = new Set([
  "temp_new",
  "wind_new",
  "clouds_new",
  "precipitation_new",
  "pressure_new"
]);

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    let item: T | undefined;
    while ((item = queue.shift()) !== undefined) {
      try {
        await fn(item);
      } catch {
        /* individual tile failures are non-fatal — the frame is just partially populated */
      }
    }
  });
  await Promise.all(workers);
}

async function fetchLatestPath(): Promise<{ ts: number; path: string } | null> {
  try {
    const data = await fetchJson<{
      radar?: { past?: Array<{ time: number; path: string }> };
    }>(RAINVIEWER_API, {
      providerId: "weather-rainviewer-index",
      ttlMs: 10 * 60_000,
      timeoutMs: 8_000,
      maxResponseBytes: 512 * 1024
    });
    const past = data.radar?.past;
    if (!past?.length) return null;
    const last = past[past.length - 1]!;
    return { ts: last.time, path: last.path };
  } catch {
    return null;
  }
}

async function downloadFrame(ts: number, radarPath: string) {
  const frameDir = path.join(RADAR_DIR, String(ts));
  const tasks: { z: number; x: number; y: number }[] = [];
  for (const z of ZOOM_LEVELS) {
    const n = 2 ** z;
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) tasks.push({ z, x, y });
    }
  }

  await runWithConcurrency(tasks, TILE_CONCURRENCY, async ({ z, x, y }) => {
    const url = `https://tilecache.rainviewer.com${radarPath}/256/${z}/${x}/${y}/${RADAR_ARCHIVE_COLOR_SCHEME}/1_1.png`;
    const tile = await fetchBytes(url, {
      providerId: "weather-rainviewer-tiles",
      ttlMs: 0,
      timeoutMs: 8_000,
      maxResponseBytes: 1024 * 1024,
      acceptedContentTypes: ["image/*"]
    });
    const buf = Buffer.from(tile.body);
    const dir = path.join(frameDir, String(z), String(x));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${y}.png`), buf);
  });
}

async function pruneOldFrames() {
  const cutoffTs = Math.floor((Date.now() - RETENTION_MS) / 1000);
  const stale = await db.select().from(weatherFrames).where(lt(weatherFrames.ts, cutoffTs));
  for (const frame of stale) {
    await fs
      .rm(path.join(RADAR_DIR, String(frame.ts)), { recursive: true, force: true })
      .catch(() => {});
  }
  if (stale.length) {
    await db.delete(weatherFrames).where(lt(weatherFrames.ts, cutoffTs));
  }
}

async function archiveOnce() {
  const latest = await fetchLatestPath();
  if (!latest) return;
  const existing = await db
    .select()
    .from(weatherFrames)
    .where(lt(weatherFrames.ts, latest.ts + 1));
  if (existing.some((f) => f.ts === latest.ts)) {
    await pruneOldFrames();
    return;
  }
  await fs.mkdir(RADAR_DIR, { recursive: true });
  await downloadFrame(latest.ts, latest.path);
  await db.insert(weatherFrames).values({ ts: latest.ts }).onConflictDoNothing();
  await pruneOldFrames();
}

let archiverTimer: ReturnType<typeof setInterval> | null = null;

/** Starts the 15-minute radar tile archiver. Safe to call once at process start; downloads
 * RainViewer tiles z0–z5 for the latest frame and prunes anything older than 24h so the
 * timeline always has a rolling day of snapshots available locally (no per-request upstream
 * calls needed when a user scrubs the timeline). */
export function startRadarArchiver() {
  if (archiverTimer) return;
  void archiveOnce().catch((err) => console.warn("Radar archive failed", safeErrorLogFields(err)));
  archiverTimer = setInterval(() => {
    void archiveOnce().catch((err) =>
      console.warn("Radar archive failed", safeErrorLogFields(err))
    );
  }, ARCHIVE_INTERVAL_MS);
}

export async function listWeatherFrames(): Promise<number[]> {
  const rows = await db.select().from(weatherFrames);
  return rows.map((r) => r.ts).sort((a, b) => a - b);
}

export function radarTilePath(ts: number, z: number, x: number, y: number): string {
  return path.join(RADAR_DIR, String(ts), String(z), String(x), `${y}.png`);
}

const owmTileCache = new Map<string, { buf: Buffer; ts: number }>();
const OWM_CACHE_TTL_MS = 10 * 60_000;

export async function fetchOwmTile(
  layer: string,
  z: number,
  x: number,
  y: number
): Promise<Buffer | null> {
  const apiKey = process.env.OWM_API_KEY;
  if (!apiKey || !OWM_LAYERS.has(layer)) return null;

  const key = `${layer}/${z}/${x}/${y}`;
  const cached = owmTileCache.get(key);
  if (cached && Date.now() - cached.ts < OWM_CACHE_TTL_MS) return cached.buf;

  const url = `https://tile.openweathermap.org/map/${layer}/${z}/${x}/${y}.png?appid=${apiKey}`;
  let tile: { body: ArrayBuffer; contentType: string };
  try {
    tile = await fetchBytes(url, {
      providerId: "weather-openweathermap-tiles",
      // `owmTileCache` below is the one bounded owner of these binary buffers.
      ttlMs: 0,
      timeoutMs: 8_000,
      maxResponseBytes: 1024 * 1024,
      acceptedContentTypes: ["image/*"]
    });
  } catch {
    return null;
  }
  const buf = Buffer.from(tile.body);
  owmTileCache.set(key, { buf, ts: Date.now() });
  if (owmTileCache.size > 2000) {
    const oldest = owmTileCache.keys().next().value;
    if (oldest) owmTileCache.delete(oldest);
  }
  return buf;
}
