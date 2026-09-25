import type { FeatureCollection, Place, PlaceSourceId, PlacesSourceMeta } from "@mapos/layer-sdk";

export interface PlaceBatch {
  places: Place[];
  meta: PlacesSourceMeta;
  query?: FeatureCollection["query"];
}
export interface PlaceJob {
  source: PlaceSourceId;
  local: boolean;
  run(): Promise<PlaceBatch>;
}
interface Entry {
  results: Map<PlaceSourceId, PlaceBatch>;
  pending: number;
  bytes: number;
  touched: number;
  done: Promise<void>;
  resolve(): void;
}

/** Bounded, short-lived query snapshots, not a second provider cache. Polls join existing work.
 * Once the complete snapshot is delivered it is removed, so provider HTTP freshness still wins.
 * Local DB reads have their own two slots and cannot queue behind remote network requests. */
export function createProgressivePlaces(
  options: { waitMs?: number; maxEntries?: number; maxBytes?: number; retentionMs?: number } = {}
) {
  const waitMs = options.waitMs ?? 750;
  const maxEntries = options.maxEntries ?? 24;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const retentionMs = options.retentionMs ?? 45000;
  const entries = new Map<string, Entry>();
  let bytes = 0;
  const queues = {
    local: [] as Array<() => Promise<void>>,
    remote: [] as Array<() => Promise<void>>
  };
  const running = { local: 0, remote: 0 };
  function pump(lane: "local" | "remote") {
    while (running[lane] < (lane === "local" ? 2 : 4) && queues[lane].length) {
      const work = queues[lane].shift()!;
      running[lane]++;
      void work().finally(() => {
        running[lane]--;
        pump(lane);
      });
    }
  }
  function remove(key: string, entry: Entry) {
    if (entries.get(key) !== entry) return;
    entries.delete(key);
    bytes -= entry.bytes;
  }
  function unavailable(source: PlaceSourceId, message: string): PlaceBatch {
    return { places: [], meta: { source, state: "error", count: 0, message } };
  }
  return {
    async collect(
      key: string,
      jobs: PlaceJob[]
    ): Promise<{ results: PlaceBatch[]; pending: PlaceSourceId[]; busy?: boolean }> {
      for (const [oldKey, old] of entries)
        if (!old.pending && Date.now() - old.touched > retentionMs) remove(oldKey, old);
      let entry = entries.get(key);
      if (!entry) {
        // A completed snapshot from an abandoned viewport must not deny a fresh viewport.
        if (entries.size >= maxEntries) {
          for (const [oldKey, old] of entries) {
            if (!old.pending) remove(oldKey, old);
            if (entries.size < maxEntries) break;
          }
        }
        if (
          entries.size >= maxEntries ||
          queues.local.length + queues.remote.length + jobs.length > 64
        ) {
          return { results: [], pending: jobs.map((job) => job.source), busy: true };
        }
        let resolve!: () => void;
        const done = new Promise<void>((r) => {
          resolve = r;
        });
        entry = {
          results: new Map(),
          pending: jobs.length,
          bytes: 0,
          touched: Date.now(),
          done,
          resolve
        };
        entries.set(key, entry);
        const current = entry;
        if (!jobs.length) resolve();
        for (const job of jobs) {
          queues[job.local ? "local" : "remote"].push(async () => {
            let result: PlaceBatch;
            let size: number;
            try {
              result = await job.run();
              size = JSON.stringify(result).length * 2;
            } catch {
              result = unavailable(job.source, "Zdroj je dočasně nedostupný.");
              size = JSON.stringify(result).length * 2;
            }
            if (bytes + size > maxBytes) {
              for (const [oldKey, old] of entries) {
                if (old !== current && !old.pending) remove(oldKey, old);
                if (bytes + size <= maxBytes) break;
              }
            }
            if (size > maxBytes || bytes + size > maxBytes) {
              result = unavailable(job.source, "Výsledek překročil rozpočet dat. Přibliž mapu.");
              size = JSON.stringify(result).length * 2;
            }
            // Tiny terminal metadata remains bounded by maxEntries * source count, even at budget.
            current.results.set(job.source, result);
            current.bytes += size;
            bytes += size;
            current.pending--;
            if (!current.pending) {
              current.touched = Date.now();
              current.resolve();
            }
          });
        }
        pump("local");
        pump("remote");
      }
      entry.touched = Date.now();
      if (entry.pending) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          entry.done,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, waitMs);
          })
        ]);
        clearTimeout(timer);
      }
      // Consumers merge/mutate Place records, so no caller may mutate the retained partial snapshot.
      const results = structuredClone([...entry.results.values()]);
      const pending = jobs
        .filter((job) => !entry!.results.has(job.source))
        .map((job) => job.source);
      if (!entry.pending) remove(key, entry);
      return { results, pending };
    },
    stats() {
      return {
        entries: entries.size,
        bytes,
        localRunning: running.local,
        remoteRunning: running.remote,
        queued: queues.local.length + queues.remote.length
      };
    }
  };
}
