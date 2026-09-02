import {
  pgTable,
  char,
  text,
  timestamp,
  doublePrecision,
  integer,
  bigint,
  jsonb,
  uuid,
  boolean,
  index,
  uniqueIndex,
  customType,
  check,
  foreignKey,
  primaryKey
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  CommerceUseCaseContractV2,
  EntitlementGrantV2,
  EventDocumentV2,
  LayerImportReportV2,
  LayerManifestV2,
  ParsedLayerImportV2,
  SavedPlaceSnapshotV2
} from "@mapos/layer-sdk";
import type { PlanDiscussionMessage } from "../services/planDiscussionRepository.js";

/** PostGIS columns stay nullable during the dual-read/dual-write compatibility window. */
const geographyPoint4326 = customType<{ data: string; driverData: string }>({
  dataType: () => "geography(Point,4326)"
});
const geometryPolygon4326 = customType<{ data: string; driverData: string }>({
  dataType: () => "geometry(Polygon,4326)"
});

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

/** Shared fixed windows contain keyed HMAC bucket ids, never raw IP addresses. */
export const rateLimitWindows = pgTable(
  "rate_limit_windows",
  {
    bucketHash: char("bucket_hash", { length: 64 }).notNull(),
    windowStartMs: bigint("window_start_ms", { mode: "number" }).notNull(),
    windowMs: integer("window_ms").notNull(),
    requestCount: integer("request_count").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
  },
  (t) => [
    primaryKey({ columns: [t.bucketHash, t.windowStartMs] }),
    index("rate_limit_windows_expiry_idx").on(t.expiresAt),
    check("rate_limit_windows_bucket_hash", sql`${t.bucketHash} ~ '^[a-f0-9]{64}$'`),
    check("rate_limit_windows_window_start", sql`${t.windowStartMs} >= 0`),
    check("rate_limit_windows_window_ms", sql`${t.windowMs} > 0`),
    check("rate_limit_windows_request_count", sql`${t.requestCount} > 0`)
  ]
);

export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    displayLabel: text("display_label"),
    simulated: boolean("simulated").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    uniqueIndex("user_identities_subject_unique").on(t.type, t.provider, t.subject),
    index("user_identities_user_idx").on(t.userId, t.createdAt, t.id),
    check(
      "user_identities_type",
      sql`${t.type} IN ('email', 'wallet', 'passkey', 'oauth', 'simulated-wallet')`
    ),
    check("user_identities_provider_length", sql`char_length(${t.provider}) BETWEEN 1 AND 80`),
    check("user_identities_subject_length", sql`char_length(${t.subject}) BETWEEN 1 AND 320`),
    check(
      "user_identities_display_label_length",
      sql`${t.displayLabel} IS NULL OR char_length(${t.displayLabel}) <= 120`
    )
  ]
);

export const identityChallenges = pgTable(
  "identity_challenges",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    chainId: integer("chain_id").notNull(),
    domain: text("domain").notNull(),
    uri: text("uri").notNull(),
    nonce: text("nonce").notNull(),
    message: text("message").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true })
  },
  (t) => [
    uniqueIndex("identity_challenges_nonce_unique").on(t.nonce),
    index("identity_challenges_owner_idx").on(t.userId, t.expiresAt, t.id),
    check("identity_challenges_address", sql`${t.address} ~ '^0x[0-9A-Fa-f]{40}$'`),
    check("identity_challenges_chain_id", sql`${t.chainId} > 0`),
    check("identity_challenges_nonce", sql`${t.nonce} ~ '^[A-Za-z0-9]{8,96}$'`),
    check("identity_challenges_message_size", sql`octet_length(${t.message}) <= 16384`)
  ]
);

export const identityAuditEvents = pgTable(
  "identity_audit_events",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    identityId: uuid("identity_id").references(() => userIdentities.id, {
      onDelete: "set null"
    }),
    action: text("action").notNull(),
    provider: text("provider").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("identity_audit_events_user_idx").on(t.userId, t.createdAt, t.id),
    check(
      "identity_audit_events_action",
      sql`${t.action} IN ('challenge-created', 'identity-linked', 'identity-revoked')`
    )
  ]
);

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
    geog: geographyPoint4326("geog"),
    tags: jsonb("tags").$type<string[]>().default([]),
    kind: text("kind").notNull().default("place"),
    country: text("country"),
    authorName: text("author_name"),
    properties: jsonb("properties").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("user_pins_layer_idx").on(t.layerId),
    index("user_pins_country_idx").on(t.country),
    index("user_pins_geog_gist").using("gist", t.geog)
  ]
);

/** Short-lived import candidates are durable so preview and commit can hit different API nodes. */
export const layerImportPreviews = pgTable(
  "layer_import_previews",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    packageDigest: char("package_digest", { length: 64 }).notNull(),
    parsed: jsonb("parsed").$type<ParsedLayerImportV2>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
  },
  (t) => [
    index("layer_import_previews_owner_created_idx").on(t.userId, t.createdAt, t.id),
    index("layer_import_previews_expiry_idx").on(t.expiresAt, t.id),
    check("layer_import_previews_digest", sql`${t.packageDigest} ~ '^[0-9a-f]{64}$'`),
    check("layer_import_previews_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
    // Input remains capped at 5 MiB. Parsed canonical data may be slightly larger because it also
    // carries the preview sample/provenance, but is still bounded at rest.
    check("layer_import_previews_parsed_size", sql`octet_length(${t.parsed}::text) <= 8388608`)
  ]
);

export const layerImports = pgTable(
  "layer_imports",
  {
    id: uuid("id").primaryKey(),
    previewId: uuid("preview_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    layerId: uuid("layer_id").references(() => userLayers.id, { onDelete: "set null" }),
    packageDigest: text("package_digest").notNull(),
    format: text("format").notNull(),
    manifest: jsonb("manifest").$type<LayerManifestV2 | null>(),
    featureCount: integer("feature_count").notNull(),
    status: text("status").notNull(),
    report: jsonb("report").$type<LayerImportReportV2>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true })
  },
  (t) => [
    uniqueIndex("layer_imports_preview_unique").on(t.previewId),
    index("layer_imports_owner_created_idx").on(t.userId, t.createdAt, t.id),
    index("layer_imports_layer_idx").on(t.layerId),
    check("layer_imports_digest", sql`${t.packageDigest} ~ '^[0-9a-f]{64}$'`),
    check("layer_imports_format", sql`${t.format} IN ('mapos-package', 'geojson', 'csv')`),
    check("layer_imports_feature_count", sql`${t.featureCount} BETWEEN 0 AND 1000`),
    check("layer_imports_status", sql`${t.status} IN ('committed', 'rolled-back')`)
  ]
);

/** The route calculation is derived and can be refreshed; the user's authored plan is the
 * durable object. Keeping its versioned public contract in JSONB makes prototype migrations
 * idempotent while stops can still evolve without a destructive schema rewrite. */
export const tripPlans = pgTable(
  "trip_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    visibility: text("visibility").notNull().default("private"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("trip_plans_user_idx").on(t.userId)]
);

/** Unlisted plan links store only a one-way token digest. Revocation is immediate and historical
 * rows remain visible to the owner without making the bearer token recoverable. */
export const planShareLinks = pgTable(
  "plan_share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => tripPlans.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    permission: text("permission").notNull().default("view"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true })
  },
  (t) => [
    uniqueIndex("plan_share_links_token_unique").on(t.tokenHash),
    index("plan_share_links_owner_plan_idx").on(t.ownerUserId, t.planId, t.createdAt),
    check("plan_share_links_token_hash", sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check("plan_share_links_permission", sql`${t.permission} = 'view'`)
  ]
);

/** A bounded, plan-scoped discussion is durable across API restarts while remaining owner-only. */
export const planDiscussionThreads = pgTable(
  "plan_discussion_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => tripPlans.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    messages: jsonb("messages").$type<PlanDiscussionMessage[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("plan_discussion_threads_owner_plan_idx").on(t.ownerUserId, t.planId, t.updatedAt),
    check("plan_discussion_threads_revision", sql`${t.revision} >= 0`),
    check("plan_discussion_threads_message_count", sql`${t.messageCount} BETWEEN 0 AND 40`),
    check(
      "plan_discussion_threads_messages",
      sql`jsonb_typeof(${t.messages}) = 'array' AND octet_length(${t.messages}::text) <= 262144`
    )
  ]
);

export const canonicalPlaces = pgTable(
  "canonical_places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    geog: geographyPoint4326("geog"),
    category: text("category"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("canonical_places_lnglat_idx").on(t.lng, t.lat),
    index("canonical_places_geog_gist").using("gist", t.geog)
  ]
);

export const placeSources = pgTable(
  "place_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => canonicalPlaces.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceRef: text("source_ref").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    uniqueIndex("place_sources_source_ref_unique").on(t.source, t.sourceRef),
    index("place_sources_place_idx").on(t.placeId)
  ]
);

export const savedPlaceCollections = pgTable(
  "saved_place_collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon"),
    color: text("color"),
    visibility: text("visibility").notNull().default("private"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    uniqueIndex("saved_place_collections_user_id_unique").on(t.userId, t.id),
    uniqueIndex("saved_place_collections_user_name_unique").on(t.userId, t.name),
    index("saved_place_collections_user_idx").on(t.userId, t.name, t.id),
    check("saved_place_collections_name_length", sql`char_length(${t.name}) BETWEEN 1 AND 120`),
    check(
      "saved_place_collections_icon_length",
      sql`${t.icon} IS NULL OR char_length(${t.icon}) <= 80`
    ),
    check(
      "saved_place_collections_color_format",
      sql`${t.color} IS NULL OR ${t.color} ~ '^#[0-9A-Fa-f]{6}$'`
    ),
    check(
      "saved_place_collections_visibility",
      sql`${t.visibility} IN ('private', 'unlisted', 'public')`
    )
  ]
);

export const savedPlaces = pgTable(
  "saved_places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    canonicalPlaceId: uuid("canonical_place_id"),
    userPinId: uuid("user_pin_id"),
    externalFeatureRef: text("external_feature_ref"),
    embeddedSnapshot: jsonb("embedded_snapshot").$type<SavedPlaceSnapshotV2>(),
    sourceSnapshot: jsonb("source_snapshot").$type<SavedPlaceSnapshotV2>(),
    category: text("category").notNull().default("place"),
    note: text("note"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    collectionId: uuid("collection_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    foreignKey({
      name: "saved_places_collection_owner_fk",
      columns: [t.userId, t.collectionId],
      foreignColumns: [savedPlaceCollections.userId, savedPlaceCollections.id]
    }).onDelete("restrict"),
    check(
      "saved_places_exactly_one_target",
      sql`num_nonnulls(${t.canonicalPlaceId}, ${t.userPinId}, ${t.externalFeatureRef}, ${t.embeddedSnapshot}) = 1`
    ),
    check(
      "saved_places_snapshot_policy",
      sql`(${t.embeddedSnapshot} IS NOT NULL AND ${t.sourceSnapshot} IS NULL)
        OR (${t.embeddedSnapshot} IS NULL AND ${t.sourceSnapshot} IS NOT NULL)`
    ),
    check(
      "saved_places_snapshot_bounds",
      sql`(${t.embeddedSnapshot} IS NULL OR (
          jsonb_typeof(${t.embeddedSnapshot}) = 'object'
          AND octet_length(${t.embeddedSnapshot}::text) <= 32768
        ))
        AND (${t.sourceSnapshot} IS NULL OR (
          jsonb_typeof(${t.sourceSnapshot}) = 'object'
          AND octet_length(${t.sourceSnapshot}::text) <= 32768
        ))`
    ),
    check(
      "saved_places_external_ref_length",
      sql`${t.externalFeatureRef} IS NULL OR char_length(${t.externalFeatureRef}) BETWEEN 1 AND 320`
    ),
    check("saved_places_category_length", sql`char_length(${t.category}) BETWEEN 1 AND 80`),
    check("saved_places_note_length", sql`${t.note} IS NULL OR char_length(${t.note}) <= 4000`),
    check(
      "saved_places_tags_shape",
      sql`jsonb_typeof(${t.tags}) = 'array'
        AND jsonb_array_length(${t.tags}) <= 24
        AND octet_length(${t.tags}::text) <= 4096`
    ),
    check("saved_places_sort_order_range", sql`${t.sortOrder} BETWEEN -1000000000 AND 1000000000`),
    index("saved_places_user_cursor_idx").on(t.userId, t.sortOrder, t.createdAt, t.id),
    index("saved_places_user_category_idx").on(t.userId, t.category),
    index("saved_places_user_collection_idx").on(t.userId, t.collectionId)
  ]
);

/** Canonical events keep the complete public v2 document while typed columns provide bounded
 * spatial/time candidate lookup. Provider identities remain lossless in event_sources. */
export const canonicalEvents = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    revision: integer("revision").notNull().default(1),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    venueName: text("venue_name").notNull(),
    normalizedVenue: text("normalized_venue").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    timezone: text("timezone").notNull(),
    status: text("status").notNull(),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    geog: geographyPoint4326("geog"),
    officialUrl: text("official_url"),
    organizerName: text("organizer_name"),
    normalizedOrganizer: text("normalized_organizer"),
    document: jsonb("document").$type<EventDocumentV2>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("events_time_idx").on(t.startsAt, t.id),
    index("events_status_time_idx").on(t.status, t.startsAt),
    index("events_candidate_idx").on(t.normalizedTitle, t.normalizedVenue, t.startsAt),
    index("events_official_url_idx").on(t.officialUrl),
    index("events_geog_gist").using("gist", t.geog),
    check(
      "events_status",
      sql`${t.status} IN ('scheduled', 'postponed', 'cancelled', 'rescheduled', 'completed', 'unknown')`
    ),
    check("events_document_shape", sql`jsonb_typeof(${t.document}) = 'object'`),
    check("events_document_bounds", sql`octet_length(${t.document}::text) <= 262144`)
  ]
);

export const eventSources = pgTable(
  "event_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: text("event_id")
      .notNull()
      .references(() => canonicalEvents.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    sourceId: text("source_id").notNull(),
    sourceUrl: text("source_url"),
    attribution: text("attribution").notNull(),
    license: text("license"),
    confidence: doublePrecision("confidence"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({})
  },
  (t) => [
    uniqueIndex("event_sources_provider_source_unique").on(t.providerId, t.sourceId),
    index("event_sources_event_idx").on(t.eventId),
    check(
      "event_sources_confidence",
      sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1)`
    ),
    check("event_sources_payload_bounds", sql`octet_length(${t.payload}::text) <= 131072`)
  ]
);

export const eventPerformers = pgTable(
  "event_performers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: text("event_id")
      .notNull()
      .references(() => canonicalEvents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    role: text("role"),
    url: text("url")
  },
  (t) => [
    uniqueIndex("event_performers_event_name_unique").on(t.eventId, t.normalizedName),
    index("event_performers_name_idx").on(t.normalizedName)
  ]
);

export const eventTicketOffers = pgTable(
  "event_ticket_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: text("event_id")
      .notNull()
      .references(() => canonicalEvents.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    url: text("url").notNull(),
    label: text("label"),
    currency: text("currency"),
    minPrice: doublePrecision("min_price"),
    maxPrice: doublePrecision("max_price"),
    availability: text("availability").notNull().default("unknown")
  },
  (t) => [
    uniqueIndex("event_ticket_offers_event_source_url_unique").on(t.eventId, t.sourceId, t.url),
    index("event_ticket_offers_event_idx").on(t.eventId),
    check("event_ticket_offers_price_min", sql`${t.minPrice} IS NULL OR ${t.minPrice} >= 0`),
    check("event_ticket_offers_price_max", sql`${t.maxPrice} IS NULL OR ${t.maxPrice} >= 0`)
  ]
);

export const eventSeriesRelations = pgTable(
  "event_series_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: text("event_id")
      .notNull()
      .references(() => canonicalEvents.id, { onDelete: "cascade" }),
    relatedEventId: text("related_event_id").references(() => canonicalEvents.id, {
      onDelete: "set null"
    }),
    externalSeriesId: text("external_series_id"),
    relationType: text("relation_type").notNull()
  },
  (t) => [
    index("event_series_relations_event_idx").on(t.eventId),
    index("event_series_relations_external_idx").on(t.externalSeriesId),
    check(
      "event_series_relations_target",
      sql`num_nonnulls(${t.relatedEventId}, ${t.externalSeriesId}) = 1`
    ),
    check(
      "event_series_relations_type",
      sql`${t.relationType} IN ('occurrence-of', 'rescheduled-from', 'rescheduled-to')`
    )
  ]
);

export const commerceUseCases = pgTable(
  "commerce_use_cases",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull().default("draft"),
    productType: text("product_type").notNull(),
    productId: text("product_id").notNull(),
    providerId: text("provider_id"),
    contract: jsonb("contract").$type<CommerceUseCaseContractV2>().notNull(),
    realProviderApproved: boolean("real_provider_approved").notNull().default(false),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    uniqueIndex("commerce_use_cases_product_unique").on(t.productType, t.productId),
    check("commerce_use_cases_status", sql`${t.status} IN ('draft', 'approved', 'disabled')`),
    check(
      "commerce_use_cases_contract_bounds",
      sql`jsonb_typeof(${t.contract}) = 'object' AND octet_length(${t.contract}::text) <= 65536`
    )
  ]
);

export const commerceProducts = pgTable(
  "commerce_products",
  {
    id: text("id").primaryKey(),
    useCaseId: text("use_case_id")
      .notNull()
      .references(() => commerceUseCases.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    providerId: text("provider_id"),
    name: text("name").notNull(),
    description: text("description"),
    publicMetadata: jsonb("public_metadata").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    check("commerce_products_status", sql`${t.status} IN ('draft', 'active', 'disabled')`),
    check(
      "commerce_products_public_metadata_bounds",
      sql`jsonb_typeof(${t.publicMetadata}) = 'object'
        AND octet_length(${t.publicMetadata}::text) <= 32768`
    )
  ]
);

export const commerceOffers = pgTable(
  "commerce_offers",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => commerceProducts.id, { onDelete: "restrict" }),
    billingUnit: text("billing_unit").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    grants: jsonb("grants").$type<EntitlementGrantV2[]>().notNull(),
    periodCount: integer("period_count").notNull().default(1),
    status: text("status").notNull().default("draft"),
    providerPriceId: text("provider_price_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("commerce_offers_product_idx").on(t.productId, t.status),
    check(
      "commerce_offers_billing_unit",
      sql`${t.billingUnit} IN ('one-time', 'month', 'year', 'usage', 'tip')`
    ),
    check("commerce_offers_amount", sql`${t.amountMinor} >= 0`),
    check(
      "commerce_offers_grants_bounds",
      sql`jsonb_typeof(${t.grants}) = 'array' AND jsonb_array_length(${t.grants}) BETWEEN 1 AND 16`
    ),
    check("commerce_offers_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("commerce_offers_status", sql`${t.status} IN ('draft', 'active', 'disabled')`)
  ]
);

export const commerceOrders = pgTable(
  "commerce_orders",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    offerId: text("offer_id")
      .notNull()
      .references(() => commerceOffers.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    provider: text("provider").notNull(),
    providerOrderId: text("provider_order_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    referralId: text("referral_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    uniqueIndex("commerce_orders_idempotency_unique").on(t.idempotencyKey),
    uniqueIndex("commerce_orders_provider_order_unique").on(t.provider, t.providerOrderId),
    index("commerce_orders_user_idx").on(t.userId, t.createdAt, t.id),
    check(
      "commerce_orders_status",
      sql`${t.status} IN ('pending', 'paid', 'cancelled', 'refunded', 'failed')`
    ),
    check(
      "commerce_orders_provider",
      sql`${t.provider} IN ('none', 'synthetic', 'stripe', 'crypto', 'external')`
    ),
    check("commerce_orders_amount", sql`${t.amountMinor} >= 0`),
    check("commerce_orders_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`)
  ]
);

export const commerceSubscriptions = pgTable(
  "commerce_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    offerId: text("offer_id")
      .notNull()
      .references(() => commerceOffers.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    provider: text("provider").notNull(),
    providerSubscriptionId: text("provider_subscription_id"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
    cancelAt: timestamp("cancel_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("commerce_subscriptions_user_idx").on(t.userId, t.status),
    uniqueIndex("commerce_subscriptions_provider_unique").on(t.provider, t.providerSubscriptionId),
    check(
      "commerce_subscriptions_status",
      sql`${t.status} IN ('trial', 'pending', 'active', 'past_due', 'cancel_at_period_end', 'cancelled', 'expired', 'refunded')`
    ),
    check(
      "commerce_subscriptions_provider",
      sql`${t.provider} IN ('none', 'synthetic', 'stripe', 'crypto', 'external')`
    )
  ]
);

export const commerceEntitlements = pgTable(
  "commerce_entitlements",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    productType: text("product_type").notNull(),
    productId: text("product_id").notNull(),
    productProviderId: text("product_provider_id"),
    status: text("status").notNull(),
    grants: jsonb("grants").$type<EntitlementGrantV2[]>().notNull(),
    sourceProvider: text("source_provider"),
    externalCustomerId: text("external_customer_id"),
    externalTransactionId: text("external_transaction_id"),
    referralId: text("referral_id"),
    orderId: text("order_id").references(() => commerceOrders.id, { onDelete: "restrict" }),
    subscriptionId: text("subscription_id").references(() => commerceSubscriptions.id, {
      onDelete: "restrict"
    }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("commerce_entitlements_access_idx").on(
      t.subjectType,
      t.subjectId,
      t.productType,
      t.productId,
      t.status,
      t.endsAt
    ),
    index("commerce_entitlements_order_idx").on(t.orderId),
    check(
      "commerce_entitlements_status",
      sql`${t.status} IN ('pending', 'active', 'grace', 'expired', 'revoked', 'refunded')`
    ),
    check(
      "commerce_entitlements_grants_bounds",
      sql`jsonb_typeof(${t.grants}) = 'array' AND jsonb_array_length(${t.grants}) BETWEEN 1 AND 16`
    ),
    check(
      "commerce_entitlements_subject_scope",
      sql`((${t.subjectType} = 'user' AND ${t.userId} IS NOT NULL AND ${t.subjectId} = ${t.userId}::text) OR (${t.subjectType} <> 'user' AND ${t.userId} IS NULL))`
    )
  ]
);

export const commerceReferrals = pgTable(
  "commerce_referrals",
  {
    id: text("id").primaryKey(),
    campaign: text("campaign").notNull(),
    partnerId: text("partner_id").notNull(),
    source: text("source").notNull(),
    sessionHash: text("session_hash").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    privacyBasis: text("privacy_basis").notNull(),
    convertedOrderId: text("converted_order_id").references(() => commerceOrders.id, {
      onDelete: "set null"
    }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    payoutStatus: text("payout_status").notNull().default("not-applicable"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    uniqueIndex("commerce_referrals_dedupe_unique").on(t.dedupeKey),
    index("commerce_referrals_expiry_idx").on(t.expiresAt, t.payoutStatus),
    check("commerce_referrals_session_hash", sql`${t.sessionHash} ~ '^[0-9a-f]{64}$'`),
    check("commerce_referrals_dedupe_key", sql`${t.dedupeKey} ~ '^[0-9a-f]{64}$'`),
    check(
      "commerce_referrals_payout_status",
      sql`${t.payoutStatus} IN ('not-applicable', 'pending', 'eligible', 'paid', 'void')`
    )
  ]
);

export const commerceTips = pgTable(
  "commerce_tips",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    recipientType: text("recipient_type").notNull(),
    recipientId: text("recipient_id").notNull(),
    provider: text("provider").notNull(),
    network: text("network"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    feeMinor: bigint("fee_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull(),
    status: text("status").notNull(),
    providerTransactionId: text("provider_transaction_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    uniqueIndex("commerce_tips_idempotency_unique").on(t.idempotencyKey),
    check(
      "commerce_tips_provider",
      sql`${t.provider} IN ('none', 'synthetic', 'stripe', 'crypto', 'external')`
    ),
    check(
      "commerce_tips_amount",
      sql`${t.amountMinor} > 0 AND ${t.feeMinor} BETWEEN 0 AND ${t.amountMinor}`
    ),
    check("commerce_tips_status", sql`${t.status} IN ('pending', 'paid', 'refunded', 'failed')`)
  ]
);

export const commercePaymentEvents = pgTable(
  "commerce_payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    type: text("type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    signatureVerified: boolean("signature_verified").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    outcome: text("outcome").notNull().default("received"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    uniqueIndex("commerce_payment_events_provider_event_unique").on(t.provider, t.providerEventId),
    check(
      "commerce_payment_events_provider",
      sql`${t.provider} IN ('synthetic', 'stripe', 'crypto', 'external')`
    ),
    check("commerce_payment_events_verified", sql`${t.signatureVerified}`),
    check(
      "commerce_payment_events_outcome",
      sql`${t.outcome} IN ('received', 'applied', 'ignored', 'failed')`
    )
  ]
);

export const commerceLedgerEntries = pgTable(
  "commerce_ledger_entries",
  {
    id: text("id").primaryKey(),
    operationKey: text("operation_key").notNull(),
    paymentEventId: uuid("payment_event_id").references(() => commercePaymentEvents.id, {
      onDelete: "restrict"
    }),
    orderId: text("order_id").references(() => commerceOrders.id, { onDelete: "restrict" }),
    subscriptionId: text("subscription_id").references(() => commerceSubscriptions.id, {
      onDelete: "restrict"
    }),
    entitlementId: text("entitlement_id").references(() => commerceEntitlements.id, {
      onDelete: "restrict"
    }),
    entryType: text("entry_type").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    uniqueIndex("commerce_ledger_operation_unique").on(t.operationKey),
    index("commerce_ledger_entitlement_idx").on(t.entitlementId, t.effectiveAt, t.id),
    check(
      "commerce_ledger_entry_type",
      sql`${t.entryType} IN ('payment', 'grant', 'revoke', 'refund', 'cancel', 'expire', 'reconcile', 'tip')`
    )
  ]
);

export const commerceReconciliationRuns = pgTable(
  "commerce_reconciliation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    checkedCount: integer("checked_count").notNull().default(0),
    repairedCount: integer("repaired_count").notNull().default(0),
    discrepancies: jsonb("discrepancies").$type<Record<string, unknown>[]>().notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    check(
      "commerce_reconciliation_provider",
      sql`${t.provider} IN ('none', 'synthetic', 'stripe', 'crypto', 'external')`
    ),
    check("commerce_reconciliation_status", sql`${t.status} IN ('running', 'complete', 'failed')`),
    check("commerce_reconciliation_counts", sql`${t.checkedCount} >= 0 AND ${t.repairedCount} >= 0`)
  ]
);

export const socialFollows = pgTable(
  "social_follows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [uniqueIndex("social_follows_unique").on(t.userId, t.targetType, t.targetId)]
);

export const socialReviews = pgTable(
  "social_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    rating: integer("rating").notNull(),
    body: text("body"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [uniqueIndex("social_reviews_unique").on(t.userId, t.targetType, t.targetId)]
);

export const socialComments = pgTable(
  "social_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("social_comments_target_idx").on(t.targetType, t.targetId)]
);

export const contentDrafts = pgTable(
  "content_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("content_drafts_user_idx").on(t.userId)]
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
    geog: geographyPoint4326("geog"),
    tags: jsonb("tags").$type<Record<string, string>>().default({}),
    cellId: text("cell_id").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("osm_pois_category_idx").on(t.category),
    index("osm_pois_lnglat_idx").on(t.lng, t.lat),
    index("osm_pois_cell_idx").on(t.cellId),
    index("osm_pois_geog_gist").using("gist", t.geog)
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
    geog: geographyPoint4326("geog"),
    cellId: text("cell_id").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("mapy_pois_category_idx").on(t.category),
    index("mapy_pois_lnglat_idx").on(t.lng, t.lat),
    index("mapy_pois_cell_idx").on(t.cellId),
    index("mapy_pois_geog_gist").using("gist", t.geog)
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
    geog: geographyPoint4326("geog"),
    rating: doublePrecision("rating"),
    reviews: integer("reviews").default(0),
    services: jsonb("services").$type<string[]>().default([]),
    photoThumb: text("photo_thumb"),
    cellId: text("cell_id").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [
    index("p4n_places_lnglat_idx").on(t.lng, t.lat),
    index("p4n_places_cell_idx").on(t.cellId),
    index("park4night_places_geog_gist").using("gist", t.geog)
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
    geog: geographyPoint4326("geog"),
    gotchiId: text("gotchi_id"),
    spawnedAt: timestamp("spawned_at", { withTimezone: true }).defaultNow().notNull(),
    caughtBy: uuid("caught_by").references(() => users.id, { onDelete: "set null" }),
    caughtAt: timestamp("caught_at", { withTimezone: true })
  },
  (t) => [
    index("game_ghosts_cell_idx").on(t.cellId),
    index("game_ghosts_geog_gist").using("gist", t.geog)
  ]
);

export const gameZones = pgTable(
  "game_zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    geog: geographyPoint4326("geog"),
    geom: geometryPolygon4326("geom"),
    radiusM: doublePrecision("radius_m").notNull().default(200),
    description: text("description"),
    lootTier: text("loot_tier").notNull().default("low"),
    lootTable: jsonb("loot_table").$type<string[]>().default([]),
    zoneKind: text("zone_kind").notNull().default("standard"),
    minStakeUsd: doublePrecision("min_stake_usd").notNull().default(0),
    activeFrom: timestamp("active_from", { withTimezone: true }),
    activeUntil: timestamp("active_until", { withTimezone: true })
  },
  (t) => [
    index("game_zones_geog_gist").using("gist", t.geog),
    index("game_zones_geom_gist").using("gist", t.geom)
  ]
);

export const gameQuests = pgTable(
  "game_quests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zoneId: uuid("zone_id").references(() => gameZones.id),
    title: text("title").notNull(),
    description: text("description"),
    rewardPoints: integer("reward_points").notNull().default(10),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    geog: geographyPoint4326("geog")
  },
  (t) => [index("game_quests_geog_gist").using("gist", t.geog)]
);

/** One row per (player, quest) completion. The unique primary key is the idempotency
 *  guarantee: claiming twice fails at the database rather than paying out twice. */
export const questCompletions = pgTable(
  "quest_completions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Text rather than a foreign key: quests anchored to real places (see game/anchors.ts) are
    // derived from map data and have no row to point at.
    questId: text("quest_id").notNull(),
    rewardPoints: integer("reward_points").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("quest_completions_user_idx").on(t.userId)]
);

/** Per-player orb claims. Orb ids are deterministically derived from player + coordinates, so a
 * primary key makes replaying an offline/local migration idempotent. */
export const gameOrbCollections = pgTable(
  "game_orb_collections",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orbId: text("orb_id").notNull(),
    xpPoints: integer("xp_points").notNull().default(10),
    collectedAt: timestamp("collected_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [index("game_orb_collections_user_idx").on(t.userId)]
);

export const gameProfiles = pgTable(
  "game_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: text("game_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => [uniqueIndex("game_profiles_user_game_unique").on(t.userId, t.gameId)]
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
  questId: text("quest_id"),
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
    geog: geographyPoint4326("geog"),
    templateKind: text("template_kind").notNull(),
    lootTier: text("loot_tier").notNull().default("low"),
    spawnedAt: timestamp("spawned_at", { withTimezone: true }).defaultNow().notNull(),
    engagedBy: uuid("engaged_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
  },
  (t) => [
    index("game_encounters_zone_idx").on(t.zoneId),
    index("game_encounters_geog_gist").using("gist", t.geog)
  ]
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
