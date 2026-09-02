import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { eq, and, gt } from "drizzle-orm";
import { db } from "../db/index.js";
import { identityAuditEvents, sessions, userIdentities, users } from "../db/schema.js";
import { ClientError } from "../utils/clientError.js";

const SESSION_DAYS = 30;

export async function registerUser(email: string, password: string, displayName: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  if (existing.length) throw new ClientError("Email already registered");
  const passwordHash = await bcrypt.hash(password, 10);
  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .insert(users)
      .values({ email: normalizedEmail, passwordHash, displayName })
      .returning();
    const identityId = randomUUID();
    await transaction.insert(userIdentities).values({
      id: identityId,
      userId: user!.id,
      type: "email",
      provider: "password",
      subject: normalizedEmail,
      displayLabel: normalizedEmail,
      simulated: false,
      verifiedAt: null
    });
    await transaction.insert(identityAuditEvents).values({
      id: randomUUID(),
      userId: user!.id,
      identityId,
      action: "identity-linked",
      provider: "password"
    });
    return user!;
  });
}

export async function loginUser(email: string, password: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  if (!user) throw new ClientError("Invalid credentials", 401);
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new ClientError("Invalid credentials", 401);
  const sessionId = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.insert(sessions).values({ id: sessionId, userId: user.id, expiresAt });
  return { user, sessionId, expiresAt };
}

export async function logoutSession(sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Rotates a verified session in one transaction after a new authentication factor is linked. */
export async function rotateSession(userId: string, currentSessionId: string) {
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, currentSessionId),
          eq(sessions.userId, userId),
          gt(sessions.expiresAt, new Date())
        )
      )
      .limit(1);
    if (!current) throw new ClientError("Session is no longer valid", 401);
    const sessionId = nanoid(32);
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
    await transaction.delete(sessions).where(eq(sessions.id, currentSessionId));
    await transaction.insert(sessions).values({ id: sessionId, userId, expiresAt });
    return { sessionId, expiresAt };
  });
}

export async function getSessionUser(sessionId: string | undefined) {
  if (!sessionId) return null;
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  return user ?? null;
}

export function getSessionId(request: FastifyRequest): string | undefined {
  return request.cookies.session;
}

const GUEST_SESSION_DAYS = 365;

/** Creates the throwaway identity every visitor gets on first load. Everything user-scoped —
 *  XP, caught ghosts, saved places, later follows and reviews — hangs off a user id, so
 *  handing out an identity immediately is what removes the login wall from the prototype
 *  without special-casing "anonymous" through the entire data model.
 *
 *  The password hash is deliberately unusable: a guest row can only ever be reached through
 *  its session cookie, never through the login form. */
export async function createGuestUser() {
  const suffix = nanoid(12);
  const [user] = await db
    .insert(users)
    .values({
      email: `guest-${suffix}@guest.mapos.local`,
      passwordHash: `!guest-${nanoid(24)}`,
      displayName: `Poutník ${suffix.slice(0, 4).toUpperCase()}`,
      isGuest: 1
    })
    .returning();

  const sessionId = nanoid(32);
  const expiresAt = new Date(Date.now() + GUEST_SESSION_DAYS * 86400000);
  await db.insert(sessions).values({ id: sessionId, userId: user!.id, expiresAt });
  return { user: user!, sessionId, expiresAt };
}

/** Turns the current guest into a real account in place, so nothing they created is orphaned.
 *  Same row, same id — every foreign key keeps pointing at it. */
export async function upgradeGuest(
  userId: string,
  email: string,
  password: string,
  displayName: string
) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  if (existing.length) throw new ClientError("Email already registered");
  const passwordHash = await bcrypt.hash(password, 10);
  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .update(users)
      .set({ email: normalizedEmail, passwordHash, displayName, isGuest: 0 })
      .where(eq(users.id, userId))
      .returning();
    if (!user) throw new ClientError("Guest account not found", 404);
    const identityId = randomUUID();
    await transaction.insert(userIdentities).values({
      id: identityId,
      userId,
      type: "email",
      provider: "password",
      subject: normalizedEmail,
      displayLabel: normalizedEmail,
      simulated: false,
      verifiedAt: null
    });
    await transaction.insert(identityAuditEvents).values({
      id: randomUUID(),
      userId,
      identityId,
      action: "identity-linked",
      provider: "password"
    });
    return user;
  });
}

export function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.isGuest ? "" : user.email,
    displayName: user.displayName,
    isGuest: user.isGuest === 1,
    xpTotal: user.xpTotal
  };
}
