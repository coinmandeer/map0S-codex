import { createHash } from "node:crypto";
import { and, eq, inArray, or, sql as drizzleSql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  commerceEntitlements,
  commerceOrders,
  commerceReferrals,
  commerceSubscriptions,
  commerceTips,
  contentDrafts,
  gameEncounters,
  gameGhosts,
  gameOrbCollections,
  gameProfiles,
  identityAuditEvents,
  layerImports,
  planDiscussionThreads,
  planShareLinks,
  questCompletions,
  rewardEvents,
  savedPlaceCollections,
  savedPlaces,
  sessions,
  socialComments,
  socialFollows,
  socialReviews,
  stakingPositions,
  tripPlans,
  userIdentities,
  userLayers,
  userPins,
  users
} from "../db/schema.js";
import type {
  AccountDeletionResult,
  AccountExportData,
  DataRightsRecord,
  DataRightsRepository
} from "./dataRightsService.js";

function asRecords<T extends object>(rows: T[]): DataRightsRecord[] {
  return rows.map((row) => structuredClone(row) as DataRightsRecord);
}

function asRecord<T extends object>(row: T): DataRightsRecord {
  return structuredClone(row) as DataRightsRecord;
}

type DeletedCommerceKeyKind = "order" | "tip";

/** Fixed-size, domain-separated replacement for user-supplied idempotency material.
 * `/` is outside the public commerce key grammar, so a client cannot reserve this namespace. */
export function anonymizedCommerceIdempotencyKey(
  kind: DeletedCommerceKeyKind,
  rowId: string
): string {
  const digest = createHash("sha256")
    .update(`mapos-account-delete:v1:${kind}:${rowId}`)
    .digest("hex");
  return `deleted/${kind}/${digest}`;
}

export function anonymizedEntitlementSubject(entitlementId: string): string {
  const digest = createHash("sha256")
    .update(`mapos-account-delete:v1:entitlement:${entitlementId}`)
    .digest("hex");
  return `deleted/entitlement/${digest}`;
}

export function linkedWalletSubjects(
  identities: ReadonlyArray<{ type: string; subject: string }>
): string[] {
  return [
    ...new Set(
      identities
        .filter((identity) => identity.type === "wallet" || identity.type === "simulated-wallet")
        .map((identity) => identity.subject)
    )
  ];
}

/** One owner can hold user-subject entitlements and entitlements addressed to a linked wallet. */
export function ownedEntitlementPredicate(userId: string, walletSubjects: readonly string[]) {
  const userSubject = and(
    eq(commerceEntitlements.subjectType, "user"),
    eq(commerceEntitlements.subjectId, userId)
  );
  return walletSubjects.length
    ? or(
        eq(commerceEntitlements.userId, userId),
        userSubject,
        and(
          eq(commerceEntitlements.subjectType, "wallet"),
          inArray(commerceEntitlements.subjectId, [...walletSubjects])
        )
      )!
    : or(eq(commerceEntitlements.userId, userId), userSubject)!;
}

export function entitlementRetentionPlan(rows: ReadonlyArray<{ id: string; subjectType: string }>) {
  const userSubjectIds = rows.filter((row) => row.subjectType === "user").map((row) => row.id);
  return {
    allIds: rows.map((row) => row.id),
    userSubjectIds,
    detachedSubjectIds: rows.filter((row) => row.subjectType !== "user").map((row) => row.id),
    requiresPseudonymousAccount: userSubjectIds.length > 0
  };
}

/** Fields safe for both sides of the migration's subject/user CHECK. */
export function retainedEntitlementRedaction(updatedAt: Date) {
  return {
    status: "revoked" as const,
    externalCustomerId: null,
    externalTransactionId: null,
    referralId: null,
    metadata: {},
    updatedAt
  };
}

/** Durable owner-scoped adapter. Every export query selects an explicit allow-list: secrets,
 * sessions, SIWE challenges, webhook payloads, rate-limit state and provider identifiers are
 * impossible to include through a later `SELECT *` schema expansion. */
export class PostgresDataRightsRepository implements DataRightsRepository {
  async exportForOwner(userId: string): Promise<AccountExportData | null> {
    return db.transaction(async (transaction) => {
      const [account] = await transaction
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          isGuest: users.isGuest,
          avatarUrl: users.avatarUrl,
          bio: users.bio,
          homeCountry: users.homeCountry,
          xpTotal: users.xpTotal,
          createdAt: users.createdAt
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!account) return null;

      const identities = await transaction
        .select({
          id: userIdentities.id,
          type: userIdentities.type,
          provider: userIdentities.provider,
          subject: userIdentities.subject,
          displayLabel: userIdentities.displayLabel,
          simulated: userIdentities.simulated,
          verifiedAt: userIdentities.verifiedAt,
          revokedAt: userIdentities.revokedAt,
          createdAt: userIdentities.createdAt
        })
        .from(userIdentities)
        .where(eq(userIdentities.userId, userId));
      const walletSubjects = linkedWalletSubjects(identities);
      const layers = await transaction
        .select({
          id: userLayers.id,
          name: userLayers.name,
          color: userLayers.color,
          slug: userLayers.slug,
          isPublic: userLayers.isPublic,
          createdAt: userLayers.createdAt
        })
        .from(userLayers)
        .where(eq(userLayers.userId, userId));
      const layerIds = layers.map((layer) => layer.id);
      const pins = layerIds.length
        ? await transaction
            .select({
              id: userPins.id,
              layerId: userPins.layerId,
              name: userPins.name,
              description: userPins.description,
              lng: userPins.lng,
              lat: userPins.lat,
              tags: userPins.tags,
              kind: userPins.kind,
              country: userPins.country,
              authorName: userPins.authorName,
              properties: userPins.properties,
              createdAt: userPins.createdAt
            })
            .from(userPins)
            .where(inArray(userPins.layerId, layerIds))
        : [];
      const imports = await transaction
        .select({
          id: layerImports.id,
          previewId: layerImports.previewId,
          layerId: layerImports.layerId,
          packageDigest: layerImports.packageDigest,
          format: layerImports.format,
          manifest: layerImports.manifest,
          featureCount: layerImports.featureCount,
          status: layerImports.status,
          report: layerImports.report,
          createdAt: layerImports.createdAt,
          rolledBackAt: layerImports.rolledBackAt
        })
        .from(layerImports)
        .where(eq(layerImports.userId, userId));
      const placeRows = await transaction
        .select({
          id: savedPlaces.id,
          canonicalPlaceId: savedPlaces.canonicalPlaceId,
          userPinId: savedPlaces.userPinId,
          externalFeatureRef: savedPlaces.externalFeatureRef,
          embeddedSnapshot: savedPlaces.embeddedSnapshot,
          sourceSnapshot: savedPlaces.sourceSnapshot,
          category: savedPlaces.category,
          note: savedPlaces.note,
          tags: savedPlaces.tags,
          collectionId: savedPlaces.collectionId,
          sortOrder: savedPlaces.sortOrder,
          createdAt: savedPlaces.createdAt,
          updatedAt: savedPlaces.updatedAt
        })
        .from(savedPlaces)
        .where(eq(savedPlaces.userId, userId));
      const collectionRows = await transaction
        .select({
          id: savedPlaceCollections.id,
          name: savedPlaceCollections.name,
          icon: savedPlaceCollections.icon,
          color: savedPlaceCollections.color,
          visibility: savedPlaceCollections.visibility,
          createdAt: savedPlaceCollections.createdAt,
          updatedAt: savedPlaceCollections.updatedAt
        })
        .from(savedPlaceCollections)
        .where(eq(savedPlaceCollections.userId, userId));
      const plans = await transaction
        .select({
          id: tripPlans.id,
          name: tripPlans.name,
          visibility: tripPlans.visibility,
          document: tripPlans.payload,
          createdAt: tripPlans.createdAt,
          updatedAt: tripPlans.updatedAt
        })
        .from(tripPlans)
        .where(eq(tripPlans.userId, userId));
      const planShares = await transaction
        .select({
          id: planShareLinks.id,
          planId: planShareLinks.planId,
          permission: planShareLinks.permission,
          createdAt: planShareLinks.createdAt,
          revokedAt: planShareLinks.revokedAt
        })
        .from(planShareLinks)
        .where(eq(planShareLinks.ownerUserId, userId));
      const planDiscussions = await transaction
        .select({
          id: planDiscussionThreads.id,
          planId: planDiscussionThreads.planId,
          revision: planDiscussionThreads.revision,
          messageCount: planDiscussionThreads.messageCount,
          messages: planDiscussionThreads.messages,
          createdAt: planDiscussionThreads.createdAt,
          updatedAt: planDiscussionThreads.updatedAt
        })
        .from(planDiscussionThreads)
        .where(eq(planDiscussionThreads.ownerUserId, userId));
      const follows = await transaction
        .select({
          id: socialFollows.id,
          targetType: socialFollows.targetType,
          targetId: socialFollows.targetId,
          createdAt: socialFollows.createdAt
        })
        .from(socialFollows)
        .where(eq(socialFollows.userId, userId));
      const reviews = await transaction
        .select({
          id: socialReviews.id,
          targetType: socialReviews.targetType,
          targetId: socialReviews.targetId,
          rating: socialReviews.rating,
          body: socialReviews.body,
          createdAt: socialReviews.createdAt,
          updatedAt: socialReviews.updatedAt
        })
        .from(socialReviews)
        .where(eq(socialReviews.userId, userId));
      const comments = await transaction
        .select({
          id: socialComments.id,
          targetType: socialComments.targetType,
          targetId: socialComments.targetId,
          body: socialComments.body,
          createdAt: socialComments.createdAt,
          updatedAt: socialComments.updatedAt
        })
        .from(socialComments)
        .where(eq(socialComments.userId, userId));
      const drafts = await transaction
        .select({
          id: contentDrafts.id,
          kind: contentDrafts.kind,
          payload: contentDrafts.payload,
          createdAt: contentDrafts.createdAt,
          updatedAt: contentDrafts.updatedAt
        })
        .from(contentDrafts)
        .where(eq(contentDrafts.userId, userId));
      const completedQuests = await transaction
        .select({
          id: questCompletions.id,
          questId: questCompletions.questId,
          rewardPoints: questCompletions.rewardPoints,
          completedAt: questCompletions.completedAt
        })
        .from(questCompletions)
        .where(eq(questCompletions.userId, userId));
      const collectedOrbs = await transaction
        .select({
          id: gameOrbCollections.id,
          orbId: gameOrbCollections.orbId,
          xpPoints: gameOrbCollections.xpPoints,
          collectedAt: gameOrbCollections.collectedAt
        })
        .from(gameOrbCollections)
        .where(eq(gameOrbCollections.userId, userId));
      const profiles = await transaction
        .select({
          id: gameProfiles.id,
          gameId: gameProfiles.gameId,
          state: gameProfiles.payload,
          updatedAt: gameProfiles.updatedAt
        })
        .from(gameProfiles)
        .where(eq(gameProfiles.userId, userId));
      const staking = await transaction
        .select({
          stakedUsd: stakingPositions.stakedUsd,
          pendingYieldUsd: stakingPositions.pendingYieldUsd,
          totalWithdrawnUsd: stakingPositions.totalWithdrawnUsd,
          totalQuestRewardsUsd: stakingPositions.totalQuestRewardsUsd,
          lastYieldAt: stakingPositions.lastYieldAt,
          updatedAt: stakingPositions.updatedAt
        })
        .from(stakingPositions)
        .where(eq(stakingPositions.userId, userId));
      const rewards = await transaction
        .select({
          id: rewardEvents.id,
          source: rewardEvents.source,
          questId: rewardEvents.questId,
          amountUsd: rewardEvents.amountUsd,
          details: rewardEvents.details,
          createdAt: rewardEvents.createdAt
        })
        .from(rewardEvents)
        .where(eq(rewardEvents.userId, userId));
      const caughtGhostRows = await transaction
        .select({
          id: gameGhosts.id,
          gotchiId: gameGhosts.gotchiId,
          lng: gameGhosts.lng,
          lat: gameGhosts.lat,
          spawnedAt: gameGhosts.spawnedAt,
          caughtAt: gameGhosts.caughtAt
        })
        .from(gameGhosts)
        .where(eq(gameGhosts.caughtBy, userId));
      const encounterRows = await transaction
        .select({
          id: gameEncounters.id,
          zoneId: gameEncounters.zoneId,
          lng: gameEncounters.lng,
          lat: gameEncounters.lat,
          templateKind: gameEncounters.templateKind,
          lootTier: gameEncounters.lootTier,
          spawnedAt: gameEncounters.spawnedAt,
          resolvedAt: gameEncounters.resolvedAt
        })
        .from(gameEncounters)
        .where(eq(gameEncounters.engagedBy, userId));
      const orders = await transaction
        .select({
          id: commerceOrders.id,
          offerId: commerceOrders.offerId,
          status: commerceOrders.status,
          amountMinor: commerceOrders.amountMinor,
          currency: commerceOrders.currency,
          createdAt: commerceOrders.createdAt,
          paidAt: commerceOrders.paidAt,
          cancelledAt: commerceOrders.cancelledAt,
          refundedAt: commerceOrders.refundedAt,
          updatedAt: commerceOrders.updatedAt
        })
        .from(commerceOrders)
        .where(eq(commerceOrders.userId, userId));
      const subscriptions = await transaction
        .select({
          id: commerceSubscriptions.id,
          offerId: commerceSubscriptions.offerId,
          status: commerceSubscriptions.status,
          currentPeriodStart: commerceSubscriptions.currentPeriodStart,
          currentPeriodEnd: commerceSubscriptions.currentPeriodEnd,
          graceEndsAt: commerceSubscriptions.graceEndsAt,
          cancelAt: commerceSubscriptions.cancelAt,
          endedAt: commerceSubscriptions.endedAt,
          createdAt: commerceSubscriptions.createdAt,
          updatedAt: commerceSubscriptions.updatedAt
        })
        .from(commerceSubscriptions)
        .where(eq(commerceSubscriptions.userId, userId));
      const entitlements = await transaction
        .select({
          id: commerceEntitlements.id,
          subjectType: commerceEntitlements.subjectType,
          productType: commerceEntitlements.productType,
          productId: commerceEntitlements.productId,
          productProviderId: commerceEntitlements.productProviderId,
          status: commerceEntitlements.status,
          grants: commerceEntitlements.grants,
          startsAt: commerceEntitlements.startsAt,
          endsAt: commerceEntitlements.endsAt,
          createdAt: commerceEntitlements.createdAt,
          updatedAt: commerceEntitlements.updatedAt
        })
        .from(commerceEntitlements)
        .where(ownedEntitlementPredicate(userId, walletSubjects));
      const tips = await transaction
        .select({
          id: commerceTips.id,
          recipientType: commerceTips.recipientType,
          recipientId: commerceTips.recipientId,
          network: commerceTips.network,
          amountMinor: commerceTips.amountMinor,
          feeMinor: commerceTips.feeMinor,
          currency: commerceTips.currency,
          status: commerceTips.status,
          createdAt: commerceTips.createdAt,
          paidAt: commerceTips.paidAt,
          refundedAt: commerceTips.refundedAt,
          updatedAt: commerceTips.updatedAt
        })
        .from(commerceTips)
        .where(eq(commerceTips.userId, userId));

      return {
        account: asRecord(account),
        identities: asRecords(identities),
        layers: layers.map((layer) => ({
          ...asRecord(layer),
          pins: asRecords(pins.filter((pin) => pin.layerId === layer.id))
        })),
        layerImports: asRecords(imports),
        places: { saved: asRecords(placeRows), collections: asRecords(collectionRows) },
        plans: asRecords(plans),
        planCollaboration: {
          shares: asRecords(planShares),
          discussions: asRecords(planDiscussions)
        },
        social: {
          follows: asRecords(follows),
          reviews: asRecords(reviews),
          comments: asRecords(comments),
          drafts: asRecords(drafts)
        },
        game: {
          questCompletions: asRecords(completedQuests),
          orbCollections: asRecords(collectedOrbs),
          profiles: asRecords(profiles),
          staking: asRecords(staking),
          rewards: asRecords(rewards),
          caughtGhosts: asRecords(caughtGhostRows),
          encounters: asRecords(encounterRows)
        },
        commerce: {
          orders: asRecords(orders),
          subscriptions: asRecords(subscriptions),
          entitlements: asRecords(entitlements),
          tips: asRecords(tips)
        }
      };
    });
  }

  async deleteForOwner(userId: string): Promise<AccountDeletionResult | null> {
    return db.transaction(async (transaction) => {
      const [account] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!account) return null;

      const ownedOrders = await transaction
        .select({ id: commerceOrders.id })
        .from(commerceOrders)
        .where(eq(commerceOrders.userId, userId));
      const ownedSubscriptions = await transaction
        .select({ id: commerceSubscriptions.id })
        .from(commerceSubscriptions)
        .where(eq(commerceSubscriptions.userId, userId));
      const ownedWalletIdentities = await transaction
        .select({ type: userIdentities.type, subject: userIdentities.subject })
        .from(userIdentities)
        .where(
          and(
            eq(userIdentities.userId, userId),
            inArray(userIdentities.type, ["wallet", "simulated-wallet"])
          )
        );
      const walletSubjects = linkedWalletSubjects(ownedWalletIdentities);
      const ownedEntitlements = await transaction
        .select({ id: commerceEntitlements.id, subjectType: commerceEntitlements.subjectType })
        .from(commerceEntitlements)
        .where(ownedEntitlementPredicate(userId, walletSubjects));
      const ownedTips = await transaction
        .select({ id: commerceTips.id })
        .from(commerceTips)
        .where(eq(commerceTips.userId, userId));
      const hasRetainedCommerce = Boolean(
        ownedOrders.length ||
        ownedSubscriptions.length ||
        ownedEntitlements.length ||
        ownedTips.length
      );
      const entitlementPlan = entitlementRetentionPlan(ownedEntitlements);
      const needsPseudonymousAccount = Boolean(
        ownedOrders.length ||
        ownedSubscriptions.length ||
        entitlementPlan.requiresPseudonymousAccount
      );
      const digest = createHash("sha256").update(`mapos-account-delete:v1:${userId}`).digest("hex");

      // Activity markers point at shared world rows, so unlink the actor rather than deleting
      // the public fixture itself. All directly owner-scoped rows are then removed atomically.
      await transaction
        .update(gameGhosts)
        .set({ caughtBy: null, caughtAt: null })
        .where(eq(gameGhosts.caughtBy, userId));
      await transaction
        .update(gameEncounters)
        .set({ engagedBy: null, resolvedAt: null })
        .where(eq(gameEncounters.engagedBy, userId));
      await transaction.delete(savedPlaces).where(eq(savedPlaces.userId, userId));
      await transaction
        .delete(savedPlaceCollections)
        .where(eq(savedPlaceCollections.userId, userId));
      await transaction.delete(layerImports).where(eq(layerImports.userId, userId));
      await transaction.delete(userLayers).where(eq(userLayers.userId, userId));
      await transaction.delete(tripPlans).where(eq(tripPlans.userId, userId));
      await transaction.delete(socialFollows).where(eq(socialFollows.userId, userId));
      await transaction.delete(socialReviews).where(eq(socialReviews.userId, userId));
      await transaction.delete(socialComments).where(eq(socialComments.userId, userId));
      await transaction.delete(contentDrafts).where(eq(contentDrafts.userId, userId));
      await transaction.delete(questCompletions).where(eq(questCompletions.userId, userId));
      await transaction.delete(gameOrbCollections).where(eq(gameOrbCollections.userId, userId));
      await transaction.delete(gameProfiles).where(eq(gameProfiles.userId, userId));
      await transaction.delete(stakingPositions).where(eq(stakingPositions.userId, userId));
      await transaction.delete(rewardEvents).where(eq(rewardEvents.userId, userId));
      await transaction.delete(identityAuditEvents).where(eq(identityAuditEvents.userId, userId));
      await transaction.delete(userIdentities).where(eq(userIdentities.userId, userId));
      await transaction.delete(sessions).where(eq(sessions.userId, userId));

      if (ownedOrders.length) {
        const orderIds = ownedOrders.map((row) => row.id);
        const anonymizedKeys = drizzleSql.join(
          ownedOrders.map(
            (row) =>
              drizzleSql`WHEN ${commerceOrders.id} = ${row.id} THEN ${anonymizedCommerceIdempotencyKey("order", row.id)}`
          ),
          drizzleSql.raw(" ")
        );
        await transaction
          .update(commerceReferrals)
          .set({ convertedOrderId: null, convertedAt: null, metadata: {} })
          .where(inArray(commerceReferrals.convertedOrderId, orderIds));
        await transaction
          .update(commerceOrders)
          .set({
            providerOrderId: null,
            idempotencyKey: drizzleSql<string>`CASE ${anonymizedKeys} ELSE ${commerceOrders.idempotencyKey} END`,
            referralId: null
          })
          .where(eq(commerceOrders.userId, userId));
      }
      if (ownedSubscriptions.length) {
        await transaction
          .update(commerceSubscriptions)
          .set({
            status: "cancelled",
            providerSubscriptionId: null,
            cancelAt: null,
            graceEndsAt: null,
            endedAt: new Date()
          })
          .where(eq(commerceSubscriptions.userId, userId));
      }
      if (entitlementPlan.allIds.length) {
        await transaction
          .update(commerceEntitlements)
          .set(retainedEntitlementRedaction(new Date()))
          .where(inArray(commerceEntitlements.id, entitlementPlan.allIds));
      }
      if (entitlementPlan.detachedSubjectIds.length) {
        const anonymizedSubjects = drizzleSql.join(
          entitlementPlan.detachedSubjectIds.map(
            (entitlementId) =>
              drizzleSql`WHEN ${commerceEntitlements.id} = ${entitlementId} THEN ${anonymizedEntitlementSubject(entitlementId)}`
          ),
          drizzleSql.raw(" ")
        );
        await transaction
          .update(commerceEntitlements)
          .set({
            userId: null,
            subjectId: drizzleSql<string>`CASE ${anonymizedSubjects} ELSE ${commerceEntitlements.subjectId} END`
          })
          .where(inArray(commerceEntitlements.id, entitlementPlan.detachedSubjectIds));
      }
      if (ownedTips.length) {
        const anonymizedKeys = drizzleSql.join(
          ownedTips.map(
            (row) =>
              drizzleSql`WHEN ${commerceTips.id} = ${row.id} THEN ${anonymizedCommerceIdempotencyKey("tip", row.id)}`
          ),
          drizzleSql.raw(" ")
        );
        await transaction
          .update(commerceTips)
          .set({
            userId: null,
            providerTransactionId: null,
            idempotencyKey: drizzleSql<string>`CASE ${anonymizedKeys} ELSE ${commerceTips.idempotencyKey} END`,
            errorCode: null
          })
          .where(
            inArray(
              commerceTips.id,
              ownedTips.map((row) => row.id)
            )
          );
      }

      if (needsPseudonymousAccount) {
        await transaction
          .update(users)
          .set({
            email: `deleted-${digest.slice(0, 32)}@privacy.invalid`,
            passwordHash: `!deleted:${digest}`,
            displayName: "Deleted account",
            isGuest: 1,
            avatarUrl: null,
            bio: null,
            homeCountry: null,
            xpTotal: 0
          })
          .where(eq(users.id, userId));
      } else {
        await transaction.delete(users).where(eq(users.id, userId));
      }

      return hasRetainedCommerce
        ? {
            status: "deleted-with-retention",
            retained: [
              {
                domain: "commerce-audit",
                reason: "legal-and-financial-record",
                dataState: "pseudonymized-and-deactivated"
              }
            ]
          }
        : { status: "deleted", retained: [] };
    });
  }
}

export const postgresDataRightsRepository = new PostgresDataRightsRepository();
