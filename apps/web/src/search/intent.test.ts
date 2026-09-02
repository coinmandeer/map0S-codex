import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLocationIntent } from "./intent.js";

describe("resolveLocationIntent", () => {
  it("recognizes GPS before any text heuristic", () => {
    const intent = resolveLocationIntent("49°44′51″N 13°22′39″E");
    assert.equal(intent.kind, "coordinates");
  });

  it("recognizes safe share links before place search", () => {
    const intent = resolveLocationIntent("https://mapos.example/?lat=50.08&lng=14.42", {
      maposOrigins: ["https://mapos.example"]
    });
    assert.equal(intent.kind, "map-share");
  });

  it("does not pass an untrusted URL to geocoding or AI", () => {
    assert.deepEqual(resolveLocationIntent("https://attacker.test/?lat=50&lng=14"), {
      kind: "invalid",
      input: "https://attacker.test/?lat=50&lng=14",
      reason: "unsupported-url"
    });
  });

  it("classifies address, explicit city, simple city and a named place deterministically", () => {
    assert.equal(resolveLocationIntent("Vinohradská 12, Praha").kind, "address");
    assert.deepEqual(resolveLocationIntent("město: Plzeň"), {
      kind: "locality",
      input: "město: Plzeň",
      query: "Plzeň"
    });
    assert.equal(resolveLocationIntent("Praha").kind, "locality");
    assert.equal(resolveLocationIntent("Tančící dům").kind, "place");
  });

  it("classifies known POI nouns and hashtags without network data", () => {
    assert.equal(resolveLocationIntent("hrad Karlštejn").kind, "poi");
    assert.equal(resolveLocationIntent("nádraží").kind, "poi");
    assert.equal(resolveLocationIntent("café Louvre").kind, "poi");
    assert.deepEqual(resolveLocationIntent("#Gastro"), {
      kind: "category",
      input: "#Gastro",
      query: "#Gastro",
      tag: "gastro"
    });
  });

  it("uses AI only explicitly or for a request with real constraints", () => {
    assert.deepEqual(resolveLocationIntent("ai: kam na víkend"), {
      kind: "ai",
      input: "ai: kam na víkend",
      query: "kam na víkend"
    });
    assert.equal(
      resolveLocationIntent("Doporuč výlet s dětmi a s výhledem po cestě do Brna").kind,
      "ai"
    );
    assert.equal(resolveLocationIntent("Karlův most Praha").kind, "place");
  });

  it("has a stable empty intent", () => {
    assert.deepEqual(resolveLocationIntent("   "), { kind: "empty" });
    assert.equal(resolveLocationIntent("x".repeat(513)).kind, "invalid");
    assert.deepEqual(resolveLocationIntent("Praha\nBrno"), {
      kind: "invalid",
      input: "Praha\nBrno",
      reason: "invalid-text"
    });
  });
});
