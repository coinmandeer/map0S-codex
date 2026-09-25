import assert from "node:assert/strict";
import test from "node:test";
import { memoryChatRequests } from "./chatRequests.js";

test("request admission is atomic, owner scoped and cannot reuse an id for different content", async () => {
  const repository = memoryChatRequests();
  const claims = await Promise.all(
    Array.from({ length: 20 }, () => repository.claim("alice", "id", "hash"))
  );
  assert.equal(claims.filter((c) => c.status === "new").length, 1);
  assert.equal(claims.filter((c) => c.status === "busy").length, 19);
  assert.equal((await repository.claim("bob", "id", "hash")).status, "new");
  assert.equal((await repository.claim("alice", "id", "different")).status, "conflict");
  await repository.finish("alice", "id", {
    type: "error",
    code: "invalid-request",
    message: "Stopped"
  });
  const replay = await repository.claim("alice", "id", "hash");
  assert.equal(replay.status, "replay");
  assert.equal((await repository.claim("bob", "id", "hash")).status, "busy");
});
