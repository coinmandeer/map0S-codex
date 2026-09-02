import { randomUUID } from "node:crypto";
import { sql } from "../db/index.js";
import { postgresDataRightsRepository } from "./dataRightsPostgresRepository.js";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`data-rights drill failed: ${message}`);
}

function count(rows: ReadonlyArray<{ count: number | string }>): number {
  return Number(rows[0]?.count ?? Number.NaN);
}

/**
 * `user_id` is UUID while `subject_id` is TEXT. PostgreSQL assigns one type to each positional
 * parameter, so the shared user parameter must be resolved as UUID before it is converted to the
 * textual entitlement subject. Without these explicit casts a real server rejects the drill with
 * 42P08 even though both values originate from the same UUID string.
 */
export const dataRightsDrillEntitlementInsertSql = `INSERT INTO commerce_entitlements
  (id, user_id, subject_type, subject_id, product_type, product_id, status, grants,
   source_provider, external_customer_id, external_transaction_id, metadata)
 VALUES ($1::text, $2::uuid, 'user', $2::uuid::text, 'feature', $3::text, 'active',
   '["access"]'::jsonb, 'external', 'customer-private', 'transaction-private',
   '{"private":"value"}'::jsonb)`;

/**
 * Release-time PostgreSQL acceptance drill. The deployment invokes this only against the
 * disposable database restored from the production backup; no live account is created or changed.
 * It exercises the exact repository shipped in the candidate image, including commerce retention.
 */
export async function runDataRightsPostgresDrill(): Promise<void> {
  const suffix = randomUUID();
  const userId = randomUUID();
  const layerId = randomUUID();
  const pinId = randomUUID();
  const savedPlaceId = randomUUID();
  const planId = randomUUID();
  const commentId = randomUUID();
  const entitlementId = `privacy-drill-user-${suffix}`;
  const tipId = `privacy-drill-tip-${suffix}`;
  const originalTipKey = `privacy-drill-key-${suffix}`;

  await sql.begin(async (transaction) => {
    await transaction.unsafe(
      `INSERT INTO users (id, email, password_hash, display_name, is_guest, xp_total)
       VALUES ($1, $2, '!privacy-drill', 'Privacy drill', 1, 0)`,
      [userId, `privacy-drill-${suffix}@privacy.invalid`]
    );
    await transaction.unsafe(
      `INSERT INTO user_layers (id, user_id, name, color, slug, is_public)
       VALUES ($1, $2, 'Privacy drill layer', '#10b981', $3, 0)`,
      [layerId, userId, `privacy-drill-${suffix}`]
    );
    await transaction.unsafe(
      `INSERT INTO user_pins (id, layer_id, name, lng, lat, tags, properties)
       VALUES ($1, $2, 'Privacy drill pin', 14.4, 50.1, '[]'::jsonb, '{}'::jsonb)`,
      [pinId, layerId]
    );
    await transaction.unsafe(
      `INSERT INTO saved_places
        (id, user_id, external_feature_ref, source_snapshot, category, tags)
       VALUES ($1, $2, $3, '{}'::jsonb, 'place', '[]'::jsonb)`,
      [savedPlaceId, userId, `privacy-drill-place-${suffix}`]
    );
    await transaction.unsafe(
      `INSERT INTO trip_plans (id, user_id, name, visibility, payload)
       VALUES ($1, $2, 'Privacy drill plan', 'private', '{}'::jsonb)`,
      [planId, userId]
    );
    await transaction.unsafe(
      `INSERT INTO social_comments (id, user_id, target_type, target_id, body)
       VALUES ($1, $2, 'place', $3, 'Privacy drill comment')`,
      [commentId, userId, `privacy-drill-target-${suffix}`]
    );
    await transaction.unsafe(dataRightsDrillEntitlementInsertSql, [
      entitlementId,
      userId,
      `privacy-drill-product-${suffix}`
    ]);
    await transaction.unsafe(
      `INSERT INTO commerce_tips
        (id, user_id, recipient_type, recipient_id, provider, amount_minor, fee_minor, currency,
         status, provider_transaction_id, idempotency_key)
       VALUES ($1, $2, 'project', 'mapos', 'external', 100, 0, 'EUR', 'paid',
         'provider-private', $3)`,
      [tipId, userId, originalTipKey]
    );
  });

  const exported = await postgresDataRightsRepository.exportForOwner(userId);
  expect(exported, "fixture account was not exportable");
  expect(
    exported.layers.some((layer) => layer.id === layerId),
    "layer missing from export"
  );
  expect(
    exported.layers.some((layer) => Array.isArray(layer.pins)),
    "pins missing from export"
  );
  expect(
    exported.places.saved.some((place) => place.id === savedPlaceId),
    "place missing"
  );
  expect(
    exported.plans.some((plan) => plan.id === planId),
    "plan missing"
  );
  expect(
    exported.social.comments.some((comment) => comment.id === commentId),
    "comment missing"
  );
  expect(
    exported.commerce.entitlements.some((entitlement) => entitlement.id === entitlementId),
    "retained entitlement missing from export"
  );

  const result = await postgresDataRightsRepository.deleteForOwner(userId);
  expect(result?.status === "deleted-with-retention", "retention result not reported");
  expect(
    result.retained[0]?.dataState === "pseudonymized-and-deactivated",
    "retention state is inaccurate"
  );

  const removed = await sql<{ count: string }[]>`
    SELECT (
      (SELECT count(*) FROM user_layers WHERE id = ${layerId}) +
      (SELECT count(*) FROM user_pins WHERE id = ${pinId}) +
      (SELECT count(*) FROM saved_places WHERE id = ${savedPlaceId}) +
      (SELECT count(*) FROM trip_plans WHERE id = ${planId}) +
      (SELECT count(*) FROM social_comments WHERE id = ${commentId})
    )::text AS count
  `;
  expect(count(removed) === 0, "portable owner rows remain after deletion");

  const retained = await sql<
    Array<{
      email: string;
      displayName: string;
      entitlementStatus: string;
      subjectId: string;
      entitlementUserId: string | null;
      externalCustomerId: string | null;
      externalTransactionId: string | null;
      metadata: Record<string, unknown>;
      tipUserId: string | null;
      tipProviderTransactionId: string | null;
      tipIdempotencyKey: string;
    }>
  >`
    SELECT users.email,
      users.display_name AS "displayName",
      entitlement.status AS "entitlementStatus",
      entitlement.subject_id AS "subjectId",
      entitlement.user_id AS "entitlementUserId",
      entitlement.external_customer_id AS "externalCustomerId",
      entitlement.external_transaction_id AS "externalTransactionId",
      entitlement.metadata,
      tip.user_id AS "tipUserId",
      tip.provider_transaction_id AS "tipProviderTransactionId",
      tip.idempotency_key AS "tipIdempotencyKey"
    FROM users
    JOIN commerce_entitlements AS entitlement ON entitlement.id = ${entitlementId}
    JOIN commerce_tips AS tip ON tip.id = ${tipId}
    WHERE users.id = ${userId}
  `;
  const row = retained[0];
  expect(row, "required retained records disappeared");
  expect(row.email.endsWith("@privacy.invalid"), "account email was not pseudonymized");
  expect(row.displayName === "Deleted account", "account was not deactivated");
  expect(row.entitlementStatus === "revoked", "entitlement was not revoked");
  expect(
    row.subjectId === userId && row.entitlementUserId === userId,
    "required user entitlement relation is invalid"
  );
  expect(
    row.externalCustomerId === null && row.externalTransactionId === null,
    "provider entitlement identifiers remain"
  );
  expect(Object.keys(row.metadata).length === 0, "entitlement metadata remains");
  expect(row.tipUserId === null && row.tipProviderTransactionId === null, "tip remains linked");
  expect(
    row.tipIdempotencyKey.startsWith("deleted/tip/") && row.tipIdempotencyKey !== originalTipKey,
    "tip idempotency key was not anonymized"
  );

  await sql.begin(async (transaction) => {
    await transaction.unsafe("DELETE FROM commerce_tips WHERE id = $1", [tipId]);
    await transaction.unsafe("DELETE FROM commerce_entitlements WHERE id = $1", [entitlementId]);
    await transaction.unsafe("DELETE FROM users WHERE id = $1", [userId]);
  });
}
