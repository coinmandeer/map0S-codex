import { and, asc, eq, gt, isNull, sql as drizzleSql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { identityAuditEvents, identityChallenges, userIdentities } from "../../db/schema.js";
import {
  IdentityConflictError,
  IdentityVerificationError,
  type IdentityAuditEvent,
  type IdentityLink,
  type IdentityRepository,
  type SiweChallenge
} from "./identityService.js";

type IdentityRow = typeof userIdentities.$inferSelect;
type ChallengeRow = typeof identityChallenges.$inferSelect;

function identity(row: IdentityRow): IdentityLink {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as IdentityLink["type"],
    provider: row.provider,
    subject: row.subject,
    displayLabel: row.displayLabel,
    simulated: row.simulated,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}

function challenge(row: ChallengeRow): SiweChallenge {
  return {
    id: row.id,
    userId: row.userId,
    sessionId: row.sessionId,
    address: row.address,
    chainId: row.chainId,
    domain: row.domain,
    uri: row.uri,
    nonce: row.nonce,
    message: row.message,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt?.toISOString() ?? null
  };
}

function auditValues(audit: IdentityAuditEvent, identityId = audit.identityId) {
  return {
    id: audit.id,
    userId: audit.userId,
    identityId,
    action: audit.action,
    provider: audit.provider,
    createdAt: new Date(audit.createdAt)
  };
}

function identityValues(link: IdentityLink) {
  return {
    id: link.id,
    userId: link.userId,
    type: link.type,
    provider: link.provider,
    subject: link.subject,
    displayLabel: link.displayLabel,
    simulated: link.simulated,
    verifiedAt: link.verifiedAt ? new Date(link.verifiedAt) : null,
    revokedAt: link.revokedAt ? new Date(link.revokedAt) : null,
    createdAt: new Date(link.createdAt)
  };
}

function uniqueSubject(link: IdentityLink): string {
  return `${link.type}\u0000${link.provider}\u0000${link.subject}`;
}

/** Durable repository; challenge consumption and identity linking share one DB transaction. */
export class PostgresIdentityRepository implements IdentityRepository {
  async createChallenge(challengeValue: SiweChallenge, audit: IdentityAuditEvent): Promise<void> {
    await db.transaction(async (transaction) => {
      await transaction.insert(identityChallenges).values({
        id: challengeValue.id,
        userId: challengeValue.userId,
        sessionId: challengeValue.sessionId,
        address: challengeValue.address,
        chainId: challengeValue.chainId,
        domain: challengeValue.domain,
        uri: challengeValue.uri,
        nonce: challengeValue.nonce,
        message: challengeValue.message,
        issuedAt: new Date(challengeValue.issuedAt),
        expiresAt: new Date(challengeValue.expiresAt),
        usedAt: null
      });
      await transaction.insert(identityAuditEvents).values(auditValues(audit));
    });
  }

  async getChallengeForOwner(userId: string, challengeId: string): Promise<SiweChallenge | null> {
    const [row] = await db
      .select()
      .from(identityChallenges)
      .where(and(eq(identityChallenges.id, challengeId), eq(identityChallenges.userId, userId)))
      .limit(1);
    return row ? challenge(row) : null;
  }

  async consumeChallengeAndLink(
    challengeId: string,
    usedAt: string,
    link: IdentityLink,
    audit: IdentityAuditEvent
  ): Promise<IdentityLink> {
    return db.transaction(async (transaction) => {
      const at = new Date(usedAt);
      const [consumed] = await transaction
        .update(identityChallenges)
        .set({ usedAt: at })
        .where(
          and(
            eq(identityChallenges.id, challengeId),
            eq(identityChallenges.userId, link.userId),
            isNull(identityChallenges.usedAt),
            gt(identityChallenges.expiresAt, at)
          )
        )
        .returning({ id: identityChallenges.id });
      if (!consumed) {
        throw new IdentityVerificationError("SIWE challenge is expired or already used");
      }

      await transaction.execute(
        drizzleSql`SELECT pg_advisory_xact_lock(hashtextextended(${uniqueSubject(link)}, 0))`
      );
      const [existing] = await transaction
        .select()
        .from(userIdentities)
        .where(
          and(
            eq(userIdentities.type, link.type),
            eq(userIdentities.provider, link.provider),
            eq(userIdentities.subject, link.subject)
          )
        )
        .limit(1);
      if (existing && existing.userId !== link.userId) {
        throw new IdentityConflictError("Identity is linked to another account");
      }
      const [stored] = existing
        ? await transaction
            .update(userIdentities)
            .set({
              revokedAt: null,
              verifiedAt: link.verifiedAt ? new Date(link.verifiedAt) : null
            })
            .where(eq(userIdentities.id, existing.id))
            .returning()
        : await transaction.insert(userIdentities).values(identityValues(link)).returning();
      await transaction.insert(identityAuditEvents).values(auditValues(audit, stored!.id));
      return identity(stored!);
    });
  }

  async linkSimulated(link: IdentityLink, audit: IdentityAuditEvent): Promise<IdentityLink> {
    if (!link.simulated || link.type !== "simulated-wallet" || link.provider !== "simulation") {
      throw new IdentityVerificationError("Invalid simulation identity");
    }
    return db.transaction(async (transaction) => {
      await transaction.execute(
        drizzleSql`SELECT pg_advisory_xact_lock(hashtextextended(${uniqueSubject(link)}, 0))`
      );
      const [existing] = await transaction
        .select()
        .from(userIdentities)
        .where(
          and(
            eq(userIdentities.type, link.type),
            eq(userIdentities.provider, link.provider),
            eq(userIdentities.subject, link.subject)
          )
        )
        .limit(1);
      if (existing && existing.userId !== link.userId) {
        throw new IdentityConflictError("Identity is linked to another account");
      }
      const [stored] = existing
        ? await transaction
            .update(userIdentities)
            .set({
              revokedAt: null,
              verifiedAt: link.verifiedAt ? new Date(link.verifiedAt) : null
            })
            .where(eq(userIdentities.id, existing.id))
            .returning()
        : await transaction.insert(userIdentities).values(identityValues(link)).returning();
      await transaction.insert(identityAuditEvents).values(auditValues(audit, stored!.id));
      return identity(stored!);
    });
  }

  async listForOwner(userId: string): Promise<IdentityLink[]> {
    const rows = await db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.userId, userId))
      .orderBy(asc(userIdentities.createdAt), asc(userIdentities.id));
    return rows.map(identity);
  }

  async revokeForOwner(
    userId: string,
    identityId: string,
    revokedAt: string,
    audit: IdentityAuditEvent
  ): Promise<IdentityLink | null> {
    return db.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(userIdentities)
        .where(and(eq(userIdentities.id, identityId), eq(userIdentities.userId, userId)))
        .limit(1);
      if (!current) return null;
      if (current.revokedAt) return identity(current);
      const [revoked] = await transaction
        .update(userIdentities)
        .set({ revokedAt: new Date(revokedAt) })
        .where(and(eq(userIdentities.id, identityId), eq(userIdentities.userId, userId)))
        .returning();
      await transaction.insert(identityAuditEvents).values(auditValues(audit, identityId));
      return identity(revoked!);
    });
  }
}
