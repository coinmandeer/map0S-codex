import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fixture from "./fixtures/entitlement.json" with { type: "json" };
import {
  ENTITLEMENT_V2_SCHEMA,
  assertEntitlementV2,
  isEntitlementEffective,
  type EntitlementV2
} from "./index.js";

describe("Entitlement v2 contract", () => {
  it("validates the source-grounded fixture with the published JSON schema and runtime guard", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(ENTITLEMENT_V2_SCHEMA);
    assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
    assert.doesNotThrow(() => assertEntitlementV2(fixture));
  });

  it("uses a deterministic half-open interval and never treats client status alone as access", () => {
    const entitlement = fixture as EntitlementV2;
    assert.equal(
      isEntitlementEffective(entitlement, "query", new Date(entitlement.startsAt!)),
      true
    );
    assert.equal(
      isEntitlementEffective(entitlement, "query", new Date(entitlement.endsAt!)),
      false
    );
    assert.equal(isEntitlementEffective({ ...entitlement, status: "refunded" }, "query"), false);
    assert.equal(isEntitlementEffective(entitlement, "export"), false);
  });

  it("rejects duplicate grants and invalid time ordering", () => {
    assert.throws(() => assertEntitlementV2({ ...fixture, grants: ["view", "view"] }), /unique/);
    assert.throws(
      () =>
        assertEntitlementV2({
          ...fixture,
          startsAt: "2026-10-01T00:00:00Z",
          endsAt: "2026-09-01T00:00:00Z"
        }),
      /endsAt/
    );
    assert.throws(
      () =>
        assertEntitlementV2({
          ...fixture,
          source: { ...fixture.source, provider: "browser-claim" }
        }),
      /source.provider/
    );
  });
});
