import test from "node:test";
import assert from "node:assert/strict";
import { wikipediaIdentity } from "./wikipediaIdentity";
test("a common name does not choose another place; explicit identities do", () => {
  assert.equal(wikipediaIdentity(undefined, "Eixample"), null);
  assert.deepEqual(wikipediaIdentity("Q1492", "ca:Eixample"), { qid: "Q1492" });
  assert.deepEqual(wikipediaIdentity(undefined, "ca:Eixample (Tarragona)"), {
    lang: "ca",
    title: "Eixample (Tarragona)"
  });
  assert.deepEqual(wikipediaIdentity(undefined, "https://cs.wikipedia.org/wiki/Karl%C5%AFv_most"), {
    lang: "cs",
    title: "Karlův most"
  });
  assert.equal(wikipediaIdentity(undefined, "https://evil.test/wiki/Praha"), null);
});
