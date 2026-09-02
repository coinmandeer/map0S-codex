import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyAvatarSelection,
  loadAvatarInventorySelection,
  persistAvatarInventorySelection,
  placeholderAvatarInventoryProvider
} from "./avatarInventory";

function installStorage() {
  const values = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value)
    }
  };
  return values;
}

test("default inventory is an honest local placeholder, not a wallet ownership claim", async () => {
  const result = await placeholderAvatarInventoryProvider.list();
  assert.equal(result.source, "local-placeholder");
  assert.equal(result.simulated, false);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]!.selection.source, "neutral-placeholder");
  assert.equal(result.items[0]!.selection.assetId, undefined);
});

test("selection persistence is bounded and invalid values fail safe", () => {
  const storage = installStorage();
  persistAvatarInventorySelection({
    inventoryItemId: "approved-item",
    displayName: "Approved item",
    source: "verified-inventory",
    assetId: "approved-asset"
  });
  assert.equal(loadAvatarInventorySelection().assetId, "approved-asset");

  storage.set("mapos:game-avatar-selection-v1", JSON.stringify({ inventoryItemId: "broken" }));
  assert.equal(loadAvatarInventorySelection().source, "neutral-placeholder");
});

test("legacy token input remains reference metadata and cannot unlock an asset", () => {
  installStorage();
  const selection = legacyAvatarSelection("aavegotchi", "1234");
  assert.equal(selection.tokenReference, "1234");
  assert.equal(selection.assetId, undefined);
  assert.equal(selection.source, "neutral-placeholder");
});
