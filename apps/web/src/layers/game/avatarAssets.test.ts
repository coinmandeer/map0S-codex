import assert from "node:assert/strict";
import test from "node:test";
import {
  NEUTRAL_AVATAR_SELECTION,
  createAvatarAssetProvider,
  selectAvatarLod,
  validateAvatarAssetDescriptor,
  type AvatarAssetDescriptor
} from "./avatarAssets";

function approvedDescriptor(): AvatarAssetDescriptor {
  return {
    id: "approved-gotchi",
    version: "1.0.0",
    displayName: "Approved test avatar",
    kind: "glb",
    targetHeightM: 4.8,
    lods: [
      {
        level: "lod0",
        url: "/models/avatars/approved-lod0.glb",
        bytes: 700_000,
        triangles: 14_000,
        textureBytes: 4_000_000,
        drawCalls: 5
      },
      {
        level: "lod1",
        url: "/models/avatars/approved-lod1.glb",
        bytes: 400_000,
        triangles: 8_000,
        textureBytes: 2_000_000,
        drawCalls: 4
      },
      {
        level: "lod2",
        url: "/models/avatars/approved-lod2.glb",
        bytes: 180_000,
        triangles: 3_000,
        textureBytes: 1_000_000,
        drawCalls: 2
      }
    ],
    animations: { idle: ["Idle"], walk: ["Walk"], collect: ["Collect"] },
    licence: {
      status: "approved",
      sourceUrl: "https://example.test/source",
      licenceId: "TEST-LICENCE",
      evidencePath: "docs/licenses/aavegotchi-assets.md",
      attribution: "Test asset author",
      redistributionAllowed: true,
      modificationAllowed: true,
      commercialUseAllowed: true
    }
  };
}

test("asset provider keeps the neutral 3D placeholder when no approved asset exists", () => {
  const provider = createAvatarAssetProvider([]);
  assert.deepEqual(provider.resolve(NEUTRAL_AVATAR_SELECTION, "low"), {
    kind: "neutral-placeholder",
    selection: NEUTRAL_AVATAR_SELECTION,
    reason: "no-asset"
  });
});

test("prototype licence metadata is advisory while same-origin safety remains enforced", () => {
  const descriptor = approvedDescriptor();
  descriptor.licence.status = "pending";
  assert.deepEqual(validateAvatarAssetDescriptor(descriptor), []);

  const provider = createAvatarAssetProvider([descriptor]);
  assert.equal(
    provider.resolve(
      {
        inventoryItemId: "item-1",
        displayName: "Prototype token",
        source: "verified-inventory",
        assetId: descriptor.id
      },
      "balanced"
    ).kind,
    "asset-glb"
  );

  descriptor.lods[0]!.url = "https://unverified.example/gotchi.glb";
  const errors = validateAvatarAssetDescriptor(descriptor);
  assert.ok(errors.some((error) => error.includes("safe local")));

  assert.equal(
    provider.resolve(
      {
        inventoryItemId: "item-1",
        displayName: "Unsafe remote token",
        source: "verified-inventory",
        assetId: descriptor.id
      },
      "balanced"
    ).kind,
    "neutral-placeholder"
  );
});

test("approved GLB descriptors expose deterministic LOD selection", () => {
  const descriptor = approvedDescriptor();
  assert.deepEqual(validateAvatarAssetDescriptor(descriptor, "low"), []);
  assert.equal(selectAvatarLod(descriptor, "balanced", 19).level, "lod0");
  assert.equal(selectAvatarLod(descriptor, "balanced", 17).level, "lod1");
  assert.equal(selectAvatarLod(descriptor, "balanced", 14).level, "lod2");
  assert.equal(selectAvatarLod(descriptor, "low", 20).level, "lod1");

  const provider = createAvatarAssetProvider([descriptor]);
  assert.equal(
    provider.resolve(
      {
        inventoryItemId: "item-1",
        displayName: "Licensed token",
        source: "verified-inventory",
        assetId: descriptor.id
      },
      "low"
    ).kind,
    "asset-glb"
  );
});

test("low-end budget rejects an oversized avatar before fetch", () => {
  const descriptor = approvedDescriptor();
  descriptor.lods[2]!.bytes = 900_000;
  const provider = createAvatarAssetProvider([descriptor]);
  const resolution = provider.resolve(
    {
      inventoryItemId: "item-2",
      displayName: "Oversized",
      source: "verified-inventory",
      assetId: descriptor.id
    },
    "low"
  );
  assert.equal(resolution.kind, "neutral-placeholder");
  assert.equal(resolution.kind === "neutral-placeholder" ? resolution.reason : null, "budget-gate");
});
