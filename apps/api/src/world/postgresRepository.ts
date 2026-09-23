import type { WorldQuery, WorldRecord, WorldRepository, WorldTable } from "./repository.js";
import { WORLD_TABLES } from "./repository.js";
import { sql } from "../db/index.js";

type Executor = { unsafe(query: string, parameters?: never[]): PromiseLike<unknown> };
/** Domain tables keep versionable payloads; geographic columns are indexed by PostGIS. */
export class PostgresWorldRepository implements WorldRepository {
  constructor(private executor: Executor = sql as unknown as Executor) {}
  private table(table: WorldTable) {
    if (!WORLD_TABLES.includes(table)) throw new Error("Unknown world table");
    return `world_${table}`;
  }
  async get<T>(table: WorldTable, id: string): Promise<T | null> {
    const rows = (await this.executor.unsafe(`SELECT data FROM ${this.table(table)} WHERE id=$1`, [
      id
    ] as never[])) as { data: T }[];
    return rows[0]?.data ?? null;
  }
  async list<T>(table: WorldTable, query: WorldQuery = {}): Promise<T[]> {
    const args: unknown[] = [];
    const param = (value: unknown) => {
      args.push(value);
      return `$${args.length}`;
    };
    const clauses = Object.entries(query.equals ?? {}).map(
      ([key, value]) => `data->>${param(key)}=${param(String(value))}`
    );
    if (query.before !== undefined) clauses.push(`created_at < ${param(query.before)}`);
    if (query.area)
      clauses.push(
        `ST_DWithin(location, ST_SetSRID(ST_MakePoint(${param(query.area.lng)},${param(query.area.lat)}),4326)::geography,${param(query.area.radius)})`
      );
    if (query.bbox) {
      const [w, s, e, n] = query.bbox;
      clauses.push(
        `location::geometry && ST_MakeEnvelope(${param(w)},${param(s)},${param(e)},${param(n)},4326)`
      );
    }
    const rows = (await this.executor.unsafe(
      `SELECT data FROM ${this.table(table)} ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC,id LIMIT ${param(query.limit ?? 100)}`,
      args as never[]
    )) as { data: T }[];
    return rows.map((row) => row.data);
  }
  async put(table: WorldTable, value: WorldRecord) {
    if (table === "rewards" && value.mode === "gps" && !(await this.get("rewards", value.id)))
      await this.executor.unsafe("UPDATE users SET xp_total=xp_total+$1 WHERE id=$2", [
        Number(value.xp),
        value.userId
      ] as never[]);
    const loc = Number.isFinite(value.lng) && Number.isFinite(value.lat);
    await this.executor.unsafe(
      `INSERT INTO ${this.table(table)} (id,data,created_at,location) VALUES ($1,$2::jsonb,$3,${loc ? "ST_SetSRID(ST_MakePoint($4,$5),4326)::geography" : "NULL"}) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,created_at=EXCLUDED.created_at,location=EXCLUDED.location`,
      [
        value.id,
        JSON.stringify(value),
        Number(value.createdAt ?? 0),
        ...(loc ? [value.lng, value.lat] : [])
      ] as never[]
    );
  }
  async remove(table: WorldTable, id: string) {
    await this.executor.unsafe(`DELETE FROM ${this.table(table)} WHERE id=$1`, [id] as never[]);
  }
  async transaction<T>(fn: (tx: WorldRepository) => Promise<T>): Promise<T> {
    return (await sql.begin(async (tx) => {
      // Pilot is one authority. The transaction also fences a second process during restarts.
      await tx`SELECT pg_advisory_xact_lock(78125419)`;
      return await fn(new PostgresWorldRepository(tx as unknown as Executor));
    })) as T;
  }
}
