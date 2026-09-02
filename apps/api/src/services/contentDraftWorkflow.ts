import type {
  ContentDraft,
  ContentDraftProvenance,
  ContentDraftWorkflow,
  WizardContentType
} from "@mapos/layer-sdk";
import { ClientError } from "../utils/clientError.js";

const CONTENT_TYPES = new Set<WizardContentType>([
  "place",
  "layer",
  "route",
  "task",
  "quest",
  "event",
  "post"
]);

function cleanText(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, max);
}

function cleanDate(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function cleanGeometry(value: unknown): ContentDraft["geometry"] {
  const geometry = value as ContentDraft["geometry"] | null;
  if (geometry?.type === "Point") {
    const [lng, lat] = geometry.coordinates ?? [];
    if (
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      Math.abs(lng) <= 180 &&
      Math.abs(lat) <= 85
    ) {
      return { type: "Point", coordinates: [lng, lat] };
    }
  }
  if (geometry?.type === "LineString") {
    const coordinates = (Array.isArray(geometry.coordinates) ? geometry.coordinates : [])
      .filter(
        ([lng, lat]) =>
          Number.isFinite(lng) &&
          Number.isFinite(lat) &&
          Math.abs(lng) <= 180 &&
          Math.abs(lat) <= 85
      )
      .slice(0, 10_000);
    if (coordinates.length >= 2) return { type: "LineString", coordinates };
  }
  throw new ClientError("Koncept potřebuje platnou polohu");
}

function cleanProvenance(
  value: ContentDraft["provenance"],
  now: Date,
  preserveCapturedAt = false
): ContentDraftProvenance {
  const source = value?.source === "discover" ? "discover" : "create";
  const regionId = cleanText(value?.regionId, 220);
  const regionName = cleanText(value?.regionName, 180);
  return {
    kind: "user-contribution",
    source,
    sourceLabel:
      cleanText(value?.sourceLabel, 180) ||
      (source === "discover" ? "Objevuj · aktuální výřez" : "MapOS · vytvořit"),
    ...(regionId ? { regionId } : {}),
    ...(regionName ? { regionName } : {}),
    capturedAt:
      preserveCapturedAt && cleanDate(value?.capturedAt)
        ? cleanDate(value?.capturedAt)!
        : now.toISOString()
  };
}

function workflow(
  authorId: string,
  revision: number,
  status: ContentDraftWorkflow["status"],
  previous: ContentDraftWorkflow | undefined,
  now: Date
): ContentDraftWorkflow {
  return {
    revision,
    status,
    authorId,
    submittedAt: status === "in-review" ? now.toISOString() : (previous?.submittedAt ?? null),
    reviewedAt: previous?.reviewedAt ?? null,
    reviewerId: previous?.reviewerId ?? null,
    moderationNote: previous?.moderationNote ?? null
  };
}

function cleanDraftFields(input: Partial<ContentDraft>, now: Date, preserveProvenance = false) {
  const type = String(input.type ?? "place") as WizardContentType;
  if (!CONTENT_TYPES.has(type)) throw new ClientError("Neplatný typ konceptu");
  const visibility = ["private", "unlisted", "public"].includes(String(input.visibility))
    ? input.visibility!
    : "private";
  return {
    type,
    name: cleanText(input.name, 180),
    description: cleanText(input.description, 4_000),
    geometry: cleanGeometry(input.geometry),
    startsAt: cleanDate(input.startsAt),
    endsAt: cleanDate(input.endsAt),
    visibility,
    provenance: cleanProvenance(input.provenance, now, preserveProvenance)
  } satisfies Omit<ContentDraft, "id" | "workflow" | "updatedAt">;
}

export function createDraftPayload(
  authorId: string,
  input: Partial<ContentDraft>,
  now = new Date()
): Omit<ContentDraft, "id" | "updatedAt"> {
  return {
    ...cleanDraftFields(input, now),
    workflow: workflow(authorId, 1, "draft", undefined, now)
  };
}

export function reviseDraftPayload(
  authorId: string,
  current: ContentDraft,
  input: Partial<ContentDraft>,
  now = new Date()
): Omit<ContentDraft, "id" | "updatedAt"> {
  if (current.workflow?.authorId && current.workflow.authorId !== authorId) {
    throw new ClientError("Koncept patří jinému autorovi", 403);
  }
  if (["in-review", "approved"].includes(current.workflow?.status ?? "draft")) {
    throw new ClientError("Koncept je v kontrole a teď ho nelze měnit", 409);
  }
  const next = { ...current, ...input, provenance: current.provenance };
  return {
    ...cleanDraftFields(next, now, true),
    workflow: workflow(
      authorId,
      (current.workflow?.revision ?? 1) + 1,
      "draft",
      current.workflow,
      now
    )
  };
}

export function submitDraftPayload(
  authorId: string,
  current: ContentDraft,
  now = new Date()
): Omit<ContentDraft, "id" | "updatedAt"> {
  if (!current.name.trim()) throw new ClientError("Před odesláním doplň název");
  if (current.workflow?.authorId && current.workflow.authorId !== authorId) {
    throw new ClientError("Koncept patří jinému autorovi", 403);
  }
  if (current.workflow?.status === "in-review") {
    return {
      ...cleanDraftFields(current, now, true),
      workflow: current.workflow
    };
  }
  if (current.workflow?.status === "approved") {
    throw new ClientError("Příspěvek už byl schválen", 409);
  }
  return {
    ...cleanDraftFields(current, now, true),
    workflow: workflow(
      authorId,
      (current.workflow?.revision ?? 1) + 1,
      "in-review",
      current.workflow,
      now
    )
  };
}
