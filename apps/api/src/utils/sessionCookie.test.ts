import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionCookieOptions } from "./sessionCookie.js";

describe("session cookie policy", () => {
  it("is HTTP-only, same-site and secure in production", () => {
    assert.deepEqual(sessionCookieOptions(undefined, "production"), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: true
    });
  });

  it("allows the local HTTP development proxy", () => {
    assert.equal(sessionCookieOptions(undefined, "development").secure, false);
  });

  it("carries the database session expiry into the browser cookie", () => {
    const expires = new Date("2030-01-01T00:00:00.000Z");
    assert.equal(sessionCookieOptions(expires, "production").expires, expires);
  });
});
