import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  canonicalEvents,
  eventPerformers,
  eventSeriesRelations,
  eventSources,
  eventTicketOffers
} from "../schema.js";
import { eventsMigration } from "./0004_events.js";

test("0004 canonical-events migration is additive and preserves provider identities", () => {
  assert.equal(eventsMigration.version, "0004");
  assert.match(eventsMigration.checksum, /^[a-f0-9]{64}$/);
  const sql = eventsMigration.steps
    .map((step) => step.sql)
    .join("\n")
    .toLowerCase();
  for (const table of [
    "events",
    "event_sources",
    "event_performers",
    "event_ticket_offers",
    "event_series_relations"
  ]) {
    assert.match(sql, new RegExp(`create table if not exists ${table}`));
  }
  assert.match(sql, /unique \(provider_id, source_id\)/);
  assert.match(sql, /events_candidate_idx/);
  assert.match(sql, /events_geog_gist/);
  assert.doesNotMatch(sql, /drop\s+(?:table|column)/);
  assert.doesNotMatch(sql, /delete\s+from/);
  assert.doesNotMatch(sql, /alter\s+table/);
});

test("Drizzle schema mirrors canonical, source, performer, offer and series tables", () => {
  const configs = [
    canonicalEvents,
    eventSources,
    eventPerformers,
    eventTicketOffers,
    eventSeriesRelations
  ].map(getTableConfig);
  assert.deepEqual(
    configs.map((config) => config.name),
    ["events", "event_sources", "event_performers", "event_ticket_offers", "event_series_relations"]
  );
  assert.ok(
    configs[1]!.indexes.some(
      (index) => index.config.name === "event_sources_provider_source_unique"
    )
  );
  assert.ok(configs[0]!.indexes.some((index) => index.config.name === "events_candidate_idx"));
});
