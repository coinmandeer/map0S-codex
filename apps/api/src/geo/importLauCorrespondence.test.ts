import test from "node:test";
import assert from "node:assert/strict";
import { validateLauCorrespondence } from "./importLauCorrespondence.js";
const data = {
  schema: 1,
  lauYear: "2024",
  nutsEdition: "2024",
  sourceUrl:
    "https://ec.europa.eu/eurostat/documents/345175/501971/EU-27-LAU-2024-NUTS-2024.xlsx/12971f56-c035-dbab-4d9f-ff1dcc617bb3",
  sha256: "a".repeat(64),
  rows: [
    { country: "CZ", lau: "CZ_554782", nuts3: "CZ010" },
    { country: "ES", lau: "ES_43148", nuts3: "ES514" }
  ]
};
test("official codes retain their country and immutable edition", () => {
  assert.equal(validateLauCorrespondence(data).rows.length, 2);
  for (const change of [
    { lauYear: "2025" },
    { sourceUrl: "https://example.com" },
    { rows: [{ country: "CZ", lau: "CZ_554782", nuts3: "ES514" }] },
    { rows: [data.rows[0], data.rows[0]] }
  ])
    assert.throws(() => validateLauCorrespondence({ ...data, ...change }));
});
