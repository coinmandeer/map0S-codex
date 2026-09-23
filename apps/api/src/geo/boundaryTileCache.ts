import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

/** Persistent immutable tiles survive releases; RAM and disk each have an independent cap. */
export function createBoundaryTileCache(directory?: string) {
  const entries = new Map<string, Uint8Array>();
  const flights = new Map<string, Promise<Uint8Array>>();
  let size = 0,
    writes = 0,
    pruning = false;
  const MAX_BYTES = 32 * 1024 * 1024;
  async function prune() {
    if (!directory || pruning) return;
    pruning = true;
    try {
      const files = await readdir(directory);
      const records = await Promise.all(
        files
          .filter((f) => /^[a-f0-9]{64}\.mvt$/.test(f))
          .map(async (file) => {
            const path = join(directory, file);
            const info = await stat(path);
            return { path, size: info.size, time: info.mtimeMs };
          })
      );
      let bytes = records.reduce((sum, r) => sum + r.size, 0);
      records.sort((a, b) => a.time - b.time);
      while (bytes > 2 * 1024 ** 3 && records.length) {
        const first = records.shift()!;
        await unlink(first.path);
        bytes -= first.size;
      }
    } catch {
      /* Cache housekeeping must never prevent serving a map. */
    } finally {
      pruning = false;
    }
  }
  return async (keyParts: unknown[], generate: () => Promise<Uint8Array>) => {
    const key = createHash("sha256").update(JSON.stringify(keyParts)).digest("hex");
    const hit = entries.get(key);
    if (hit) {
      entries.delete(key);
      entries.set(key, hit);
      return hit;
    }
    const pending = flights.get(key);
    if (pending) return pending;
    // User-specific scopes stay in bounded RAM; only the finite shared overview pyramid persists.
    const disk = directory && keyParts[5] == null && Number(keyParts[2]) <= 9;
    const path = disk ? join(directory!, `${key}.mvt`) : null;
    const promise = (async () => {
      let tile: Uint8Array | undefined;
      if (path) {
        try {
          tile = new Uint8Array(await readFile(path));
        } catch {
          /* Cold tile. */
        }
      }
      if (!tile) {
        tile = await generate();
        if (path && tile.byteLength <= 8 * 1024 * 1024) {
          const temp = `${path}.${randomUUID()}.tmp`;
          try {
            await mkdir(directory!, { recursive: true });
            await writeFile(temp, tile);
            await rename(temp, path);
            if (++writes % 128 === 1) void prune();
          } catch {
            await unlink(temp).catch(() => {});
          }
        }
      }
      if (tile.byteLength <= MAX_BYTES) {
        entries.set(key, tile);
        size += tile.byteLength;
        while (size > MAX_BYTES || entries.size > 2048) {
          const oldest = entries.keys().next().value!;
          size -= entries.get(oldest)!.byteLength;
          entries.delete(oldest);
        }
      }
      return tile;
    })().finally(() => flights.delete(key));
    flights.set(key, promise);
    return promise;
  };
}
export const cachedBoundaryTile = createBoundaryTileCache(process.env.MAPOS_BOUNDARY_CACHE_DIR);
