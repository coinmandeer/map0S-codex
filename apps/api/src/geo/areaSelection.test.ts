import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { parseAreaReference, areaPredicate } from "./areaSelection.js";
const revision = "a".repeat(64);
test("area identity rejects incomplete, malformed and cross-level references", () => {
  assert.equal(parseAreaReference({}), null);
  for (const query of [
    { areaId: "x" },
    { boundaryRevision: revision },
    { areaId: "[]", boundaryRevision: revision },
    { areaId: JSON.stringify(["x", "CZ", "nuts3", "1"]), boundaryRevision: revision }
  ])
    assert.throws(() => parseAreaReference(query));
  const parsed = parseAreaReference({
    areaId: JSON.stringify(["gisco-lau", "CZ", "lau", "CZ_123"]),
    boundaryRevision: revision
  });
  assert.equal(parsed?.code, "CZ_123");
  assert.equal(parsed?.country, "CZ");
});
test("polygon SQL pins edition/source/country and uses covers for points, intersection for paths", () => {
  const ref = parseAreaReference({
    areaId: JSON.stringify(["gisco-lau", "CZ", "lau", "CZ_123"]),
    boundaryRevision: revision
  })!;
  const area = { ...ref, name: "Test", bbox: [0, 0, 1, 1] as [number, number, number, number] };
  const dialect = new PgDialect();
  const point = dialect.sqlToQuery(areaPredicate(area, sql`point`, true)!);
  assert.match(point.sql, /ST_Covers/);
  assert.ok(point.params.includes(revision));
  assert.ok(point.params.includes("CZ_123"));
  assert.match(dialect.sqlToQuery(areaPredicate(area, sql`path`)!).sql, /ST_Intersects/);
});
