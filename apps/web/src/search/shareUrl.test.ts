import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMapShareUrl } from "./shareUrl.js";

describe("parseMapShareUrl", () => {
  it("parses relative MapOS links and configured exact origins", () => {
    assert.deepEqual(parseMapShareUrl("/?lat=49.7475&lng=13.3775&z=14"), {
      provider: "mapos",
      lat: 49.7475,
      lng: 13.3775,
      zoom: 14
    });
    assert.deepEqual(
      parseMapShareUrl("https://mapos.example/map?lat=50.08&lng=14.42&zoom=12", {
        maposOrigins: ["https://mapos.example"]
      }),
      { provider: "mapos", lat: 50.08, lng: 14.42, zoom: 12 }
    );
  });

  it("requires an exact MapOS origin", () => {
    const options = { maposOrigins: ["https://mapos.example"] };
    assert.equal(parseMapShareUrl("https://evil.mapos.example/?lat=1&lng=2", options), null);
    assert.equal(parseMapShareUrl("https://mapos.example.evil.test/?lat=1&lng=2", options), null);
  });

  it("parses supported Google Maps coordinate formats", () => {
    assert.deepEqual(parseMapShareUrl("https://www.google.com/maps/@49.7475,13.3775,15z"), {
      provider: "google",
      lat: 49.7475,
      lng: 13.3775,
      zoom: 15
    });
    assert.deepEqual(
      parseMapShareUrl("https://maps.google.com/maps/search/?api=1&query=49.7475%2C13.3775"),
      { provider: "google", lat: 49.7475, lng: 13.3775 }
    );
  });

  it("parses OpenStreetMap, Mapy and Apple coordinate links", () => {
    assert.deepEqual(parseMapShareUrl("https://www.openstreetmap.org/#map=14/49.7475/13.3775"), {
      provider: "openstreetmap",
      lat: 49.7475,
      lng: 13.3775,
      zoom: 14
    });
    assert.equal(
      parseMapShareUrl("https://www.openstreetmap.org/#map=14/49.7475/13.3775&layers=N")?.provider,
      "openstreetmap"
    );
    assert.deepEqual(parseMapShareUrl("https://mapy.com/?x=13.3775&y=49.7475&z=13"), {
      provider: "mapy",
      lat: 49.7475,
      lng: 13.3775,
      zoom: 13
    });
    assert.deepEqual(parseMapShareUrl("https://maps.apple.com/?ll=49.7475,13.3775&z=10"), {
      provider: "apple",
      lat: 49.7475,
      lng: 13.3775,
      zoom: 10
    });
  });

  it("rejects opaque short links because resolving them would require network", () => {
    assert.equal(parseMapShareUrl("https://maps.app.goo.gl/secret"), null);
    assert.equal(parseMapShareUrl("https://mapy.cz/s/opaque"), null);
  });

  it("rejects credentials, non-HTTPS, unexpected ports and unknown hosts", () => {
    assert.equal(parseMapShareUrl("https://user:secret@www.openstreetmap.org/#map=1/1/1"), null);
    assert.equal(parseMapShareUrl("http://www.openstreetmap.org/#map=1/1/1"), null);
    assert.equal(parseMapShareUrl("https://www.openstreetmap.org:8443/#map=1/1/1"), null);
    assert.equal(parseMapShareUrl("https://attacker.test/?lat=49&lng=13"), null);
  });

  it("rejects malformed or out-of-range coordinate payloads", () => {
    assert.equal(parseMapShareUrl("/?lat=91&lng=13"), null);
    assert.equal(parseMapShareUrl("/?lat=49&lng=181"), null);
    assert.equal(parseMapShareUrl("/?lat=49"), null);
    assert.equal(parseMapShareUrl("javascript:alert(1)"), null);
  });
});
