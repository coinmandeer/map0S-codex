import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import eventDocument from "./fixtures/event-document.json" with { type: "json" };
import { EVENT_DOCUMENT_V2_SCHEMA, assertEventDocumentV2 } from "./index.js";

describe("EventDocument v2 contract", () => {
  it("validates the source-grounded multisource fixture including rescheduled status", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(EVENT_DOCUMENT_V2_SCHEMA);
    assert.equal(validate(eventDocument), true, JSON.stringify(validate.errors));
    assert.doesNotThrow(() => assertEventDocumentV2(eventDocument));
  });

  it("keeps event source attribution advisory", () => {
    const withoutAttribution: unknown = structuredClone(eventDocument);
    delete (withoutAttribution as { sources: Array<{ attribution?: unknown }> }).sources[0]!
      .attribution;
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(EVENT_DOCUMENT_V2_SCHEMA);
    assert.equal(validate(withoutAttribution), true, JSON.stringify(validate.errors));
    assert.doesNotThrow(() => assertEventDocumentV2(withoutAttribution));
  });

  it("rejects invalid time order, coordinates and duplicate provider identities", () => {
    assert.throws(
      () =>
        assertEventDocumentV2({
          ...eventDocument,
          schedule: { ...eventDocument.schedule, endsAt: "2026-10-16T10:00:00Z" }
        }),
      /endsAt/
    );
    assert.throws(
      () =>
        assertEventDocumentV2({
          ...eventDocument,
          venue: { ...eventDocument.venue, location: { type: "Point", coordinates: [181, 30] } }
        }),
      /WGS84/
    );
    assert.throws(
      () =>
        assertEventDocumentV2({
          ...eventDocument,
          sources: [eventDocument.sources[0], eventDocument.sources[0]]
        }),
      /unique provider IDs/
    );
  });
});
