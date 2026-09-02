import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import {
  ClientError,
  messageForClient,
  registerClientSafeErrorHandler,
  safeErrorLogFields,
  statusForClient
} from "./clientError.js";

describe("client-safe errors", () => {
  it("shows only messages explicitly marked as public", () => {
    assert.equal(messageForClient(new ClientError("invalid bbox"), "fallback"), "invalid bbox");
    assert.equal(
      messageForClient(
        new Error('query failed: select * from mapy_cells; parameters: ["secret"]'),
        "Zdroj je nedostupný"
      ),
      "Zdroj je nedostupný"
    );
    assert.equal(statusForClient(new ClientError("missing", 404)), 404);
    assert.equal(statusForClient(new Error("database failed")), 500);
  });

  it("sanitizes unhandled server errors", async () => {
    const app = Fastify({ logger: false });
    registerClientSafeErrorHandler(app);
    app.get("/boom", async () => {
      throw new Error('relation "mapy_cells" does not exist');
    });

    const response = await app.inject({ method: "GET", url: "/boom" });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), { message: "Interní chyba serveru" });
    await app.close();
  });

  it("reduces log errors to a bounded class name", () => {
    const error = new Error("postgres://user:secret@db/private?query=select+email");
    error.name = "Bad name https://provider.test/?key=secret";
    assert.deepEqual(safeErrorLogFields(error), { errorName: "Error" });
    assert.deepEqual(safeErrorLogFields(new TypeError("private note")), {
      errorName: "TypeError"
    });
    assert.deepEqual(safeErrorLogFields("raw failure"), { errorName: "UnknownError" });
  });

  it("keeps an explicitly public status and message", async () => {
    const app = Fastify({ logger: false });
    registerClientSafeErrorHandler(app);
    app.get("/bad", async () => {
      throw new ClientError("bbox required", 422);
    });

    const response = await app.inject({ method: "GET", url: "/bad" });
    assert.equal(response.statusCode, 422);
    assert.deepEqual(response.json(), { message: "bbox required" });
    await app.close();
  });
});
