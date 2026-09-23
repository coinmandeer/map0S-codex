import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { sql } from "../../db/index.js";
import { AiConversationStore } from "./conversation.js";
import { postgresConversationPersistence as history } from "./conversationPersistence.js";
import { postgresOverviewSnapshots as snapshots } from "./overviewSnapshots.js";
import { OverviewService } from "./overviewService.js";
import type { OverviewResult } from "@mapos/layer-sdk";

/** Runs only in the release candidate against the restored disposable database. */
export async function runOverviewPostgresDrill() {
  const owner = randomUUID(),
    other = randomUUID();
  try {
    await sql`INSERT INTO users (id,email,password_hash,display_name,is_guest,xp_total)
      VALUES (${owner},${`overview-drill-${owner}@privacy.invalid`},'!drill','AI release drill',1,0)`;
    const store = new AiConversationStore();
    const first = store.create(owner, { type: "global" });
    await history.save(first, null);
    const updated = { ...first, revision: 1 };
    const contenders = await Promise.allSettled(
      Array.from({ length: 8 }, () => history.save(updated, 0))
    );
    assert.equal(
      contenders.filter((result) => result.status === "fulfilled").length,
      1,
      "CAS admitted more than one writer"
    );
    const restored = new AiConversationStore();
    restored.restore(owner, await history.load(owner, first.id));
    assert.equal(restored.get(owner, first.id).revision, 1);
    await assert.rejects(history.load(other, first.id));
    const service = new OverviewService({
      detail: async () => {
        throw new Error("coordinate must not resolve a POI");
      }
    });
    const recipe = {
      target: { type: "coordinate" as const, lng: 1.2, lat: 41.1 },
      consent: { externalModel: false }
    };
    let result: OverviewResult | undefined;
    await service.run(
      recipe,
      { ownerUserId: owner, permissionRevision: "drill", allowedLayerIds: new Set() },
      new AbortController().signal,
      (event) => {
        result = event.snapshot;
      }
    );
    assert(result);
    const id = await snapshots.save(owner, recipe, result);
    assert.equal((await snapshots.get(owner, id))?.result.targetKey, result.targetKey);
    assert.equal(await snapshots.get(other, id), null);
    assert.equal((await snapshots.list(owner)).length, 1);
    console.log(
      "AI overview PostgreSQL drill: CAS 1/8, fresh-store restore, snapshot owner isolation passed"
    );
  } finally {
    await sql`DELETE FROM users WHERE id=${owner} AND email=${`overview-drill-${owner}@privacy.invalid`}`;
    await sql.end();
  }
}
