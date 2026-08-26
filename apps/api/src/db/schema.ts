import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  jsonb,
  uuid,
  index
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  /** Guests are real users with a synthetic email and no usable password. Keeping them in the
   *  same table is what lets progress, pins and follows carry over on upgrade — there is one
   *  identity across game, map and social from the very first page load. */
  isGuest: integer("is_guest").notNull().default(0),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  homeCountry: text("home_country"),
  xpTotal: integer("xp_total").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
});

export const userLayers = pgTable("user_layers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#10b981"),
  slug: text("slug").notNull().unique(),
  isPublic: integer("is_public").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const userPins = pgTable(
  "user_pins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    layerId: uuid("layer_id")
      .notNull()
      .references(() => userLayers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    tags: jsonb("tags").$type<string[]>().default([]),
    kind: text("kind").notNull().default("place"),
    country: text("country"),
    authorName: text("author_name"),
    properties: jsonb("properties").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("user_pins_layer_idx").on(t.layerId), index("user_pins_country_idx").on(t.country)]
);

export const overpassCache = pgTable(
  "overpass_cache",
  {
    id: text("id").primaryKey(),
    categories: text("categories").notNull(),
    bboxKey: text("bbox_key").notNull(),
    data: jsonb("data").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("overpass_cache_bbox_idx").on(t.bboxKey)]
);

/** One row per OSM POI, kept warm across many overlapping viewports. Populated lazily,
 * cell by cell, by osmCellService as users pan around ("world-lazy" ingestion). */
export const osmPois = pgTable(
  "osm_pois",
  {
    id: text("id").primaryKey(),
    osmId: text("osm_id").notNull(),
    category: text("category").notNull(),
    name: text("name"),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    tags: jsonb("tags").$type<Record<string, string>>().default({}),
    cellId: text("cell_id").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("osm_pois_category_idx").on(t.category),
    index("osm_pois_lnglat_idx").on(t.lng, t.lat),
    index("osm_pois_cell_idx").on(t.cellId)
  ]
);

/** Tracks which (z7 cell, category) combinations have already been fetched from Overpass,
 * so repeated pans over the same area never re-hit the upstream API within the TTL window. */
export const osmCells = pgTable(
  "osm_cells",
  {
    id: text("id").primaryKey(),
    cellId: text("cell_id").notNull(),
    category: text("category").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("osm_cells_lookup_idx").on(t.cellId, t.category)]
);

/** Places found through Mapy.com's keyword-matrix scan. Kept separate from `osm_pois` because
 *  the two have different licences and refresh semantics; the fusion service merges them at
 *  read time rather than mixing them at rest. */
export const mapyPois = pgTable(
  "mapy_pois",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    name: text("name").notNull(),
    label: text("label"),
    location: text("location"),
    poiType: text("poi_type"),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    cellId: text("cell_id").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("mapy_pois_category_idx").on(t.category),
    index("mapy_pois_lnglat_idx").on(t.lng, t.lat),
    index("mapy_pois_cell_idx").on(t.cellId)
  ]
);

/** Which (cell, category, keyword, lang) probes have already been spent. The keyword is part
 *  of the key because widening MAPY_KEYWORDS later must re-probe only the new words. */
export const mapyCells = pgTable(
  "mapy_cells",
  {
    id: text("id").primaryKey(),
    cellId: text("cell_id").notNull(),
    category: text("category").notNull(),
    keyword: text("keyword").notNull(),
    lang: text("lang").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("mapy_cells_lookup_idx").on(t.cellId, t.category)]
);

export const park4nightPlaces = pgTable(
  "park4night_places",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    code: text("code"),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    rating: doublePrecision("rating"),
    reviews: integer("reviews").default(0),
    services: jsonb("services").$type<string[]>().default([]),
    photoThumb: text("photo_thumb"),
    cellId: text("cell_id").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("p4n_places_lnglat_idx").on(t.lng, t.lat),
    index("p4n_places_cell_idx").on(t.cellId)
  ]
);

export const park4nightCells = pgTable("park4night_cells", {
  id: text("id").primaryKey(),
  cellId: text("cell_id").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
});

export const photoCache = pgTable("photo_cache", {
  wikidataId: text("wikidata_id").primaryKey(),
  url: text("url"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
});

export const weatherFrames = pgTable("weather_frames", {
  ts: integer("ts").primaryKey(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
});

export const gameGhosts = pgTable(
  "game_ghosts",
  {
    id: text("id").primaryKey(),
    cellId: text("cell_id").notNull(),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    gotchiId: text("gotchi_id"),
    spawnedAt: timestamp("spawned_at", { withTimezone: true }).defaultNow().notNull(),
    caughtBy: uuid("caught_by").references(() => users.id, { onDelete: "set null" }),
    caughtAt: timestamp("caught_at", { withTimezone: true })
  },
  (t) => [index("game_ghosts_cell_idx").on(t.cellId)]
);

export const gameZones = pgTable("game_zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  lng: doublePrecision("lng").notNull(),
  lat: doublePrecision("lat").notNull(),
  radiusM: doublePrecision("radius_m").notNull().default(200),
  description: text("description"),
  lootTier: text("loot_tier").notNull().default("low"),
  lootTable: jsonb("loot_table").$type<string[]>().default([]),
  zoneKind: text("zone_kind").notNull().default("standard"),
  minStakeUsd: doublePrecision("min_stake_usd").notNull().default(0),
  activeFrom: timestamp("active_from", { withTimezone: true }),
  activeUntil: timestamp("active_until", { withTimezone: true })
});

export const gameQuests = pgTable("game_quests", {
  id: uuid("id").primaryKey().defaultRandom(),
  zoneId: uuid("zone_id").references(() => gameZones.id),
  title: text("title").notNull(),
  description: text("description"),
  rewardPoints: integer("reward_points").notNull().default(10),
  lng: doublePrecision("lng").notNull(),
  lat: doublePrecision("lat").notNull()
});

/** One row per (player, quest) completion. The unique primary key is the idempotency
 *  guarantee: claiming twice fails at the database rather than paying out twice. */
export const questCompletions = pgTable(
  "quest_completions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questId: uuid("quest_id")
      .notNull()
      .references(() => gameQuests.id, { onDelete: "cascade" }),
    rewardPoints: integer("reward_points").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("quest_completions_user_idx").on(t.userId)]
);

export const stakingPositions = pgTable("staking_positions", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  stakedUsd: doublePrecision("staked_usd").notNull().default(0),
  pendingYieldUsd: doublePrecision("pending_yield_usd").notNull().default(0),
  totalWithdrawnUsd: doublePrecision("total_withdrawn_usd").notNull().default(0),
  totalQuestRewardsUsd: doublePrecision("total_quest_rewards_usd").notNull().default(0),
  lastYieldAt: timestamp("last_yield_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const rewardEvents = pgTable("reward_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  questId: uuid("quest_id"),
  amountUsd: doublePrecision("amount_usd").notNull().default(0),
  details: jsonb("details").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const gameEncounters = pgTable(
  "game_encounters",
  {
    id: text("id").primaryKey(),
    zoneId: uuid("zone_id").references(() => gameZones.id),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    templateKind: text("template_kind").notNull(),
    lootTier: text("loot_tier").notNull().default("low"),
    spawnedAt: timestamp("spawned_at", { withTimezone: true }).defaultNow().notNull(),
    engagedBy: uuid("engaged_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
  },
  (t) => [index("game_encounters_zone_idx").on(t.zoneId)]
);

export const placeEnrichment = pgTable("place_enrichment", {
  id: text("id").primaryKey(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
});

export const regionSummaries = pgTable("region_summaries", {
  regionId: text("region_id").primaryKey(),
  text: text("text").notNull(),
  model: text("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
