export const WORLD_TABLES = [
  "profiles",
  "rewards",
  "contacts",
  "blocks",
  "favorites",
  "threads",
  "messages",
  "reads",
  "quests",
  "reports",
  "raid_results",
  "actions"
] as const;
export type WorldTable = (typeof WORLD_TABLES)[number];
export type WorldRecord = { id: string; [key: string]: unknown };
export interface WorldQuery {
  equals?: Record<string, string | number | boolean>;
  before?: number;
  limit?: number;
  area?: { lng: number; lat: number; radius: number };
  bbox?: [number, number, number, number];
}
export interface WorldRepository {
  get<T>(table: WorldTable, id: string): Promise<T | null>;
  list<T>(table: WorldTable, query?: WorldQuery): Promise<T[]>;
  put(table: WorldTable, value: WorldRecord): Promise<void>;
  remove(table: WorldTable, id: string): Promise<void>;
  transaction<T>(fn: (tx: WorldRepository) => Promise<T>): Promise<T>;
}
export function distance(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export class MemoryWorldRepository implements WorldRepository {
  constructor(private onReward?: (reward: WorldRecord) => void) {}
  private tables = new Map<WorldTable, Map<string, WorldRecord>>();
  private inTransaction = false;
  private tail: Promise<unknown> = Promise.resolve();
  private table(name: WorldTable) {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = new Map();
      this.tables.set(name, rows);
    }
    return rows;
  }
  async get<T>(table: WorldTable, id: string): Promise<T | null> {
    return structuredClone(this.table(table).get(id) ?? null) as T | null;
  }
  async list<T>(table: WorldTable, query: WorldQuery = {}): Promise<T[]> {
    return structuredClone(
      [...this.table(table).values()]
        .filter((row) => {
          if (Object.entries(query.equals ?? {}).some(([k, v]) => row[k] !== v)) return false;
          if (query.before !== undefined && Number(row.createdAt) >= query.before) return false;
          if (
            query.area &&
            distance(row as unknown as { lng: number; lat: number }, query.area) > query.area.radius
          )
            return false;
          if (query.bbox) {
            const [w, s, e, n] = query.bbox;
            if (!(
              Number(row.lng) >= w &&
              Number(row.lng) <= e &&
              Number(row.lat) >= s &&
              Number(row.lat) <= n
            ))
              return false;
          }
          return true;
        })
        .sort(
          (a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0) || a.id.localeCompare(b.id)
        )
        .slice(0, query.limit ?? 100)
    ) as T[];
  }
  async put(table: WorldTable, value: WorldRecord) {
    if (!this.inTransaction) return this.transaction((tx) => tx.put(table, value));
    this.table(table).set(value.id, structuredClone(value));
  }
  async remove(table: WorldTable, id: string) {
    if (!this.inTransaction) return this.transaction((tx) => tx.remove(table, id));
    this.table(table).delete(id);
  }
  transaction<T>(fn: (tx: WorldRepository) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const tx = new MemoryWorldRepository();
      tx.tables = structuredClone(this.tables);
      tx.inTransaction = true;
      const result = await fn(tx);
      const newRewards = [...tx.table("rewards").values()].filter(
        (r) => !this.table("rewards").has(r.id)
      );
      this.tables = tx.tables;
      for (const reward of newRewards) this.onReward?.(reward);
      return result;
    });
    this.tail = run.catch(() => {});
    return run;
  }
}
