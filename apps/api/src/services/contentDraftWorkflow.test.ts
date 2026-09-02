import assert from "node:assert/strict";
import test from "node:test";
import type { ContentDraft } from "@mapos/layer-sdk";
import {
  createDraftPayload,
  reviseDraftPayload,
  submitDraftPayload
} from "./contentDraftWorkflow.js";

const firstAt = new Date("2026-09-02T12:00:00.000Z");
const secondAt = new Date("2026-09-02T12:05:00.000Z");

function contributionInput(): Partial<ContentDraft> {
  return {
    type: "post",
    name: "Klidná vyhlídka",
    description: "Místní tip bez reklamy.",
    geometry: { type: "Point", coordinates: [13.3775, 49.7475] },
    startsAt: null,
    endsAt: null,
    visibility: "public",
    provenance: {
      kind: "user-contribution",
      source: "discover",
      sourceLabel: "Objevuj · Plzeň",
      regionId: "nominatim:relation:123",
      regionName: "Plzeň",
      capturedAt: "1999-01-01T00:00:00.000Z"
    },
    workflow: {
      revision: 999,
      status: "approved",
      authorId: "forged-author",
      submittedAt: null,
      reviewedAt: null,
      reviewerId: null,
      moderationNote: null
    }
  };
}

test("draft workflow derives author, provenance time and first revision on the server", () => {
  const created = createDraftPayload("author-1", contributionInput(), firstAt);
  assert.equal(created.workflow?.authorId, "author-1");
  assert.equal(created.workflow?.revision, 1);
  assert.equal(created.workflow?.status, "draft");
  assert.equal(created.provenance?.capturedAt, firstAt.toISOString());
  assert.equal(created.provenance?.source, "discover");
});

test("revision preserves server provenance and submission advances into review", () => {
  const created = createDraftPayload("author-1", contributionInput(), firstAt) as ContentDraft;
  const revised = reviseDraftPayload(
    "author-1",
    created,
    { description: "Upřesněný tip." },
    secondAt
  );
  assert.equal(revised.workflow?.revision, 2);
  assert.equal(revised.workflow?.status, "draft");
  assert.equal(revised.provenance?.capturedAt, firstAt.toISOString());

  const submitted = submitDraftPayload("author-1", revised as ContentDraft, secondAt);
  assert.equal(submitted.workflow?.revision, 3);
  assert.equal(submitted.workflow?.status, "in-review");
  assert.equal(submitted.workflow?.submittedAt, secondAt.toISOString());
  assert.equal(submitted.workflow?.reviewerId, null);
});
