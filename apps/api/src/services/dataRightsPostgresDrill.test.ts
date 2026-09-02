import assert from "node:assert/strict";
import test from "node:test";
import { dataRightsDrillEntitlementInsertSql } from "./dataRightsPostgresDrill.js";

test("the PostgreSQL data-rights drill resolves the shared UUID parameter before text conversion", () => {
  assert.match(dataRightsDrillEntitlementInsertSql, /\$2::uuid/);
  assert.match(dataRightsDrillEntitlementInsertSql, /\$2::uuid::text/);
  assert.doesNotMatch(dataRightsDrillEntitlementInsertSql, /\$2::text/);
});
