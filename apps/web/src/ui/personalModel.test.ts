import assert from "node:assert/strict";
import { test } from "node:test";
import type { SavedPlaceV2 } from "@mapos/layer-sdk";
import {
  filterPersonalPlaces,
  personalCategoryCounts,
  personalCategoryLabel,
  walletSubtitle
} from "./personalModel";

function place(id: string, title: string, category: string, tags: string[] = []): SavedPlaceV2 {
  return {
    schema: "mapos.saved-place",
    schemaVersion: "2.0.0",
    id,
    ownerUserId: "owner-1",
    target: { type: "embedded-snapshot" },
    snapshot: {
      title,
      position: [14.4, 50.1],
      category,
      sourceRefs: [],
      capturedAt: "2026-09-02T08:00:00.000Z"
    },
    category,
    note: null,
    tags,
    collectionId: null,
    sortOrder: 0,
    createdAt: "2026-09-02T08:00:00.000Z",
    updatedAt: "2026-09-02T08:00:00.000Z"
  };
}

test("category counts are deterministic, localized and based only on the authorized input", () => {
  const result = personalCategoryCounts([
    place("1", "Západ slunce", "viewpoint"),
    place("2", "Ranní výhled", "viewpoint"),
    place("3", "Espresso", "cafe")
  ]);
  assert.deepEqual(result, [
    { id: "cafe", label: "Kavárny", count: 1 },
    { id: "viewpoint", label: "Vyhlídky", count: 2 }
  ]);
});

test("text and category filters compose and search title, note or tags", () => {
  const inputs = [
    { ...place("1", "Západ slunce", "viewpoint", ["výlet"]), note: "Klidný kopec" },
    place("2", "Ranní výhled", "viewpoint", ["východ"]),
    place("3", "Espresso", "cafe", ["výlet"])
  ];
  assert.deepEqual(
    filterPersonalPlaces(inputs, "výlet", "viewpoint").map(({ id }) => id),
    ["1"]
  );
  assert.deepEqual(
    filterPersonalPlaces(inputs, "KOPEC", null).map(({ id }) => id),
    ["1"]
  );
});

test("unknown categories keep a stable readable fallback", () => {
  assert.equal(personalCategoryLabel("quiet_spot"), "quiet spot");
});

test("a wallet row shows the network and balance only when the chain actually said so", () => {
  const wallet = { subject: "0x1234567890abcdef1234567890abcdef12345678", simulated: false };
  assert.equal(
    walletSubtitle(wallet, { networkName: "Base", balance: 1.2345, symbol: "ETH" }),
    "0x1234…5678 · Base · 1.235 ETH"
  );
  // Locked wallet, or one not authorised for this site: the ordinary state of a freshly opened
  // page. Showing less is right; showing a zero balance would be a fabrication.
  assert.equal(walletSubtitle(wallet, null), "0x1234…5678");
});

test("a simulated identity is labelled as one and never given a network", () => {
  const simulated = { subject: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", simulated: true };
  assert.equal(
    walletSubtitle(simulated, { networkName: "Ethereum", balance: 5, symbol: "ETH" }),
    "0xabcd…abcd · simulace",
    "there is no chain behind a simulation, so it cannot report one"
  );
});
