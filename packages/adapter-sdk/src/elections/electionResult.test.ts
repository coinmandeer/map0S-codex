import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyElection,
  electionAtYear,
  validateElection,
  type ElectionResult,
  type PartyClassification
} from "./electionResult.js";
const result: ElectionResult = {
  type: "national-parliament",
  date: "2024-06-09",
  territory: "CZ",
  electorate: 200,
  ballots: 110,
  validVotes: 100,
  parties: [
    { partyId: "a", votes: 40 },
    { partyId: "b", votes: 35 },
    { partyId: "c", votes: 25 }
  ]
};
const c = (partyId: string, lrgen: number): PartyClassification => ({
  partyId,
  lrgen,
  validFrom: "2024-01-01",
  validTo: "2024-12-31",
  sourceUrl: "https://www.chesdata.eu/ches-europe/"
});
test("unknown votes that can overturn a leading bloc make it uncertain", () =>
  assert.equal(classifyElection(result, [c("a", 2), c("b", 8)]).winner, "uncertain"));
test("4 and 6 belong to the centre and blocs sum votes across parties", () =>
  assert.equal(classifyElection(result, [c("a", 4), c("b", 6), c("c", 8)]).winner, "centre"));
test("expired or heterogeneous coalition classifications are not guessed", () => {
  const cc = c("a", 2);
  cc.validTo = "2023-12-31";
  assert.equal(classifyElection(result, [cc]).unclassified, 100);
  assert.equal(
    classifyElection({ ...result, parties: [{ partyId: "a", votes: 100, coalition: true }] }, [
      c("a", 2)
    ]).unclassified,
    100
  );
});
test("bad totals and missing exact dates are rejected", () => {
  assert.throws(() => validateElection({ ...result, validVotes: 101 }), /sum/);
  assert.throws(() => validateElection({ ...result, date: "2024" }), /date/);
});
test("as-of year preserves election type and never looks ahead", () => {
  const newer = { ...result, date: "2025-06-01" };
  assert.equal(electionAtYear([newer, result], result.type, "CZ", 2024)?.date, result.date);
  assert.equal(electionAtYear([result], "european-parliament", "CZ", 2024), null);
});
