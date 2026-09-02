import assert from "node:assert/strict";
import test from "node:test";
import type { LayerManifestV2 } from "@mapos/layer-sdk";
import { projectAiLayerCatalog } from "./layerCatalog.js";

function manifest(overrides: Partial<LayerManifestV2> = {}): LayerManifestV2 {
  return {
    schema: "mapos.layer-manifest",
    schemaVersion: "2.0.0",
    sdkRange: "^2.0.0",
    id: "public-poi",
    name: "Veřejná místa",
    description: "Bezpečný veřejný katalog",
    category: "travel",
    geometryKinds: ["Point"],
    renderer: { type: "symbols" },
    source: { type: "server-adapter", adapterId: "public-poi" },
    queryPolicy: { strategy: "viewport", cursorPagination: true },
    filters: [{ id: "kind", label: "Typ", kind: "multi-select" }],
    attribution: [{ label: "Test" }],
    capabilities: ["query", "filter", "ai-search"],
    permissions: { defaultVisibility: "public" },
    ai: {
      discoverable: true,
      searchableFields: ["title", "category"],
      tools: ["query_layer", "apply_plan_command"],
      permissionProjection: "public-features"
    },
    ...overrides
  };
}

const anonymous = {
  authenticated: false,
  ownedLayerIds: new Set<string>(),
  entitlementIds: new Set<string>()
};

test("catalog exposes only reviewed metadata and allowlisted read/draft tools", () => {
  const [entry] = projectAiLayerCatalog([manifest()], anonymous);
  assert.equal(entry?.layerId, "public-poi");
  assert.deepEqual(entry?.queryCapabilities, ["bbox", "filters", "cursor"]);
  assert.deepEqual(entry?.allowedTools, ["query_layer"]);
  assert.equal(entry?.maySendRawFieldsToExternalModel, true);
  assert.equal(JSON.stringify(entry).includes("adapterId"), false);
});

test("private and entitled layers are omitted until the actor passes their gate", () => {
  const privateLayer = manifest({
    id: "private-notes",
    permissions: { defaultVisibility: "private", requiresAuth: true },
    ai: { discoverable: true, permissionProjection: "owner-private" }
  });
  const paidLayer = manifest({
    id: "paid-camps",
    permissions: { defaultVisibility: "entitled" },
    commerce: { access: "subscription", productId: "camps-pro" },
    ai: { discoverable: true, permissionProjection: "entitled-features" }
  });
  assert.deepEqual(projectAiLayerCatalog([privateLayer, paidLayer], anonymous), []);

  const visible = projectAiLayerCatalog([privateLayer, paidLayer], {
    authenticated: true,
    ownedLayerIds: new Set(["private-notes"]),
    entitlementIds: new Set(["camps-pro"])
  });
  assert.deepEqual(
    visible.map(({ layerId, access, maySendRawFieldsToExternalModel }) => ({
      layerId,
      access,
      maySendRawFieldsToExternalModel
    })),
    [
      { layerId: "paid-camps", access: "entitled", maySendRawFieldsToExternalModel: false },
      { layerId: "private-notes", access: "owner", maySendRawFieldsToExternalModel: false }
    ]
  );
});

test("disabled and non-discoverable manifests never enter the model catalog", () => {
  assert.deepEqual(
    projectAiLayerCatalog(
      [
        manifest({ id: "hidden", ai: { discoverable: false } }),
        manifest({
          id: "disabled",
          ai: { discoverable: true, permissionProjection: "disabled" }
        })
      ],
      anonymous
    ),
    []
  );
});
