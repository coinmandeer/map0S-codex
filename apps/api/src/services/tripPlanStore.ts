import { and, desc, eq } from "drizzle-orm";
import {
  assertPlanDocumentV2,
  isPlanDocumentV2,
  planV1ToV2,
  planV2ToV1,
  type PlanDocumentV2,
  type TripPlan
} from "@mapos/layer-sdk";
import { db } from "../db/index.js";
import { tripPlans } from "../db/schema.js";
import { ClientError } from "../utils/clientError.js";
import type { PlanDocumentRepository } from "./planDocumentRepository.js";
import { normalizeTripPlan } from "./routingPlanService.js";

interface StoredPlanEnvelope {
  id: string;
  ownerId: string;
  name: string;
  visibility: PlanDocumentV2["visibility"];
  createdAt: string;
  updatedAt: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function markPersisted(document: PlanDocumentV2): PlanDocumentV2 {
  return {
    ...document,
    metadata: {
      ...(document.metadata ?? {}),
      "dev.mapos.persisted": true
    }
  };
}

/** Reads both legacy TripPlan rows and native v2 rows during the additive cutover. */
export function storedPayloadToPlanDocument(
  payload: unknown,
  envelope: StoredPlanEnvelope
): PlanDocumentV2 {
  if (isPlanDocumentV2(payload)) {
    const document = markPersisted({
      ...clone(payload),
      id: envelope.id,
      ownerId: envelope.ownerId,
      name: envelope.name,
      visibility: envelope.visibility,
      createdAt: envelope.createdAt,
      updatedAt: envelope.updatedAt
    });
    assertPlanDocumentV2(document);
    return document;
  }

  const legacy = normalizeTripPlan({
    ...(payload as Partial<TripPlan>),
    id: envelope.id,
    name: envelope.name,
    visibility: envelope.visibility,
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt
  });
  return markPersisted(
    planV1ToV2(legacy, {
      ownerId: envelope.ownerId,
      now: envelope.updatedAt
    })
  );
}

function envelopeOf(row: typeof tripPlans.$inferSelect): StoredPlanEnvelope {
  return {
    id: row.id,
    ownerId: row.userId,
    name: row.name,
    visibility: row.visibility as PlanDocumentV2["visibility"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function rowToPlanDocument(row: typeof tripPlans.$inferSelect): PlanDocumentV2 {
  return storedPayloadToPlanDocument(row.payload, envelopeOf(row));
}

function rowToPlan(row: typeof tripPlans.$inferSelect): TripPlan {
  return planV2ToV1(rowToPlanDocument(row));
}

export async function listTripPlans(userId: string) {
  const rows = await db
    .select()
    .from(tripPlans)
    .where(eq(tripPlans.userId, userId))
    .orderBy(desc(tripPlans.updatedAt));
  return rows.map(rowToPlan);
}

export async function createTripPlan(userId: string, input: Partial<TripPlan>) {
  const plan = normalizeTripPlan(input);
  const [row] = await db
    .insert(tripPlans)
    .values({
      userId,
      name: plan.name,
      visibility: plan.visibility,
      payload: plan as unknown as Record<string, unknown>
    })
    .returning();
  if (!row) throw new Error("Plan was not created");
  return rowToPlan(row);
}

export async function updateTripPlan(userId: string, id: string, input: Partial<TripPlan>) {
  const plan = normalizeTripPlan({ ...input, id });
  const [row] = await db
    .update(tripPlans)
    .set({
      name: plan.name,
      visibility: plan.visibility,
      payload: plan as unknown as Record<string, unknown>,
      updatedAt: new Date()
    })
    .where(and(eq(tripPlans.id, id), eq(tripPlans.userId, userId)))
    .returning();
  if (!row) throw new ClientError("Plán nebyl nalezen", 404);
  return rowToPlan(row);
}

export async function deleteTripPlan(userId: string, id: string) {
  const rows = await db
    .delete(tripPlans)
    .where(and(eq(tripPlans.id, id), eq(tripPlans.userId, userId)))
    .returning({ id: tripPlans.id });
  if (!rows.length) throw new ClientError("Plán nebyl nalezen", 404);
}

export async function listPlanDocuments(ownerId: string): Promise<PlanDocumentV2[]> {
  const rows = await db
    .select()
    .from(tripPlans)
    .where(eq(tripPlans.userId, ownerId))
    .orderBy(desc(tripPlans.updatedAt));
  return rows.map(rowToPlanDocument);
}

export async function getPlanDocument(ownerId: string, id: string): Promise<PlanDocumentV2 | null> {
  const [row] = await db
    .select()
    .from(tripPlans)
    .where(and(eq(tripPlans.id, id), eq(tripPlans.userId, ownerId)))
    .limit(1);
  return row ? rowToPlanDocument(row) : null;
}

export async function createPlanDocument(
  ownerId: string,
  input: PlanDocumentV2
): Promise<PlanDocumentV2> {
  assertPlanDocumentV2(input);
  return db.transaction(async (tx) => {
    const now = new Date();
    const candidate = markPersisted({
      ...clone(input),
      ownerId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
    const [row] = await tx
      .insert(tripPlans)
      .values({
        userId: ownerId,
        name: candidate.name,
        visibility: candidate.visibility,
        payload: candidate as unknown as Record<string, unknown>,
        createdAt: now,
        updatedAt: now
      })
      .returning();
    if (!row) throw new Error("Plan was not created");
    const document = markPersisted({ ...candidate, id: row.id });
    await tx
      .update(tripPlans)
      .set({ payload: document as unknown as Record<string, unknown> })
      .where(eq(tripPlans.id, row.id));
    assertPlanDocumentV2(document);
    return document;
  });
}

export async function replacePlanDocument(
  ownerId: string,
  id: string,
  input: PlanDocumentV2,
  expectedRevision: number
): Promise<PlanDocumentV2> {
  assertPlanDocumentV2(input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(tripPlans)
      .where(and(eq(tripPlans.id, id), eq(tripPlans.userId, ownerId)))
      .limit(1)
      .for("update");
    if (!row) throw new ClientError("Plán nebyl nalezen", 404);
    const current = rowToPlanDocument(row);
    if (current.revision !== expectedRevision) {
      throw new ClientError(`Plán se mezitím změnil (aktuální revize ${current.revision})`, 409);
    }
    const updatedAt = new Date();
    const document = markPersisted({
      ...clone(input),
      id,
      ownerId,
      revision: Math.max(current.revision + 1, input.revision),
      createdAt: current.createdAt,
      updatedAt: updatedAt.toISOString()
    });
    assertPlanDocumentV2(document);
    const [updated] = await tx
      .update(tripPlans)
      .set({
        name: document.name,
        visibility: document.visibility,
        payload: document as unknown as Record<string, unknown>,
        updatedAt
      })
      .where(and(eq(tripPlans.id, id), eq(tripPlans.userId, ownerId)))
      .returning();
    if (!updated) throw new ClientError("Plán nebyl nalezen", 404);
    return document;
  });
}

export const postgresPlanDocumentRepository: PlanDocumentRepository = {
  list: listPlanDocuments,
  get: getPlanDocument,
  create: createPlanDocument,
  replace: replacePlanDocument,
  delete: deleteTripPlan
};
