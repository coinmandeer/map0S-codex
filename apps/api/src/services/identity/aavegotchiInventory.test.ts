import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AAVEGOTCHI_SOURCE_EVIDENCE,
  GatedAavegotchiInventoryAdapter,
  SimulatedAavegotchiInventoryAdapter
} from "./aavegotchiInventory.js";

const address = "0x1234567890abcdef1234567890abcdef12345678";

describe("Aavegotchi inventory source gate", () => {
  it("records current primary-source evidence but makes no live holdings claim without an indexer", async () => {
    assert.equal(AAVEGOTCHI_SOURCE_EVIDENCE.network, "base");
    assert.equal(AAVEGOTCHI_SOURCE_EVIDENCE.chainId, 8453);
    assert.match(AAVEGOTCHI_SOURCE_EVIDENCE.diamondAddress, /^0x[0-9a-f]{40}$/);
    assert.equal(AAVEGOTCHI_SOURCE_EVIDENCE.indexerEndpoint, null);

    const result = await new GatedAavegotchiInventoryAdapter(
      () => new Date("2026-09-01T12:00:00.000Z")
    ).load(address);
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable") {
      assert.equal(result.reason, "official-indexer-required");
      assert.match(result.notice, /nepředstírá/);
    }
  });

  it("fails closed when source verification becomes stale", async () => {
    const result = await new GatedAavegotchiInventoryAdapter(
      () => new Date("2027-01-01T00:00:00.000Z")
    ).load(address);
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable") assert.equal(result.reason, "source-review-expired");
  });

  it("returns bounded fixtures only through an explicitly enabled simulation adapter", async () => {
    const items = [
      {
        tokenId: "42",
        name: "Fixture Gotchi",
        wearableIds: ["1", "2", "2"],
        metadataSourceUrl: null
      }
    ];
    const disabled = await new SimulatedAavegotchiInventoryAdapter(items, false).load(address);
    assert.equal(disabled.status, "unavailable");

    const enabled = await new SimulatedAavegotchiInventoryAdapter(
      items,
      true,
      () => new Date("2026-09-01T12:00:00.000Z")
    ).load(address);
    assert.equal(enabled.status, "available");
    if (enabled.status === "available") {
      assert.equal(enabled.sourceMode, "simulation");
      assert.deepEqual(enabled.items[0]?.wearableIds, ["1", "2"]);
      assert.match(enabled.notice, /Testovací data/);
      assert.equal(enabled.chainId, null);
    }
  });

  it("rejects malformed wallet and fixture identifiers", async () => {
    await assert.rejects(
      new GatedAavegotchiInventoryAdapter().load("coinmandeer.eth"),
      /wallet address/
    );
    assert.throws(
      () =>
        new SimulatedAavegotchiInventoryAdapter(
          [
            { tokenId: "1", name: null, wearableIds: [], metadataSourceUrl: null },
            { tokenId: "1", name: null, wearableIds: [], metadataSourceUrl: null }
          ],
          true
        ),
      /duplicate inventory token/
    );
  });
});
