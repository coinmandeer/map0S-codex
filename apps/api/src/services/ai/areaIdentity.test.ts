import test from "node:test";
import assert from "node:assert/strict";
import { areaIdentifier } from "./areaIdentity.js";
test("municipality identity uses official codes, never a same-named province", () => {
  assert.deepEqual(
    areaIdentifier({ source: "gisco-lau-cz", country: "CZ", level: "lau", code: "CZ_554782" }),
    { property: "P7606", value: "554782", country: "CZ" }
  );
  assert.deepEqual(
    areaIdentifier({ source: "gisco-lau-es", country: "ES", level: "lau", code: "ES_43148" }),
    { property: "P772", value: "43148", country: "ES" }
  );
  assert.equal(
    areaIdentifier({
      source: "gb-es-adm2",
      country: "ES",
      level: "adm2",
      code: "93216281B93269883088590"
    }),
    null
  );
  assert.equal(
    areaIdentifier({
      source: "gisco-lau-es",
      country: "ES",
      level: "lau",
      code: 'ES_43148" injection'
    }),
    null
  );
});
