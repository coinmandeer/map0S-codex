import assert from "node:assert/strict";
import test, { describe, it } from "node:test";
import type { GeoFeature, LayerManifestV2 } from "@mapos/layer-sdk";
import {
  detailActionsFromManifest,
  detailFieldLabel,
  detailFieldsFromFeature,
  detailMediaFromFeature,
  detailSurfaceOrder,
  formatDetailDate,
  osmCorrectionUrl,
  safeExternalUrl
} from "./detailModel";
import { setActiveLocale } from "../i18n";

const feature: GeoFeature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [14.2, 50.1] },
  properties: {
    id: "partner:42",
    name: "Partner stop",
    category: "camper-stop",
    layerId: "trail-partner",
    providerFields: {
      "trail-partner": { pitchClass: "P", sockets: 4, internalSecret: "never render" }
    },
    externalUrl: "https://partner.example/stop/42"
  }
};

const manifest: LayerManifestV2 = {
  schema: "mapos.layer-manifest",
  schemaVersion: "2.0.0",
  sdkRange: "^2.0.0",
  id: "trail-partner",
  name: "Trail Partner",
  description: "Synthetic partner fixture",
  category: "travel",
  geometryKinds: ["Point"],
  renderer: { type: "symbols" },
  source: { type: "server-adapter" },
  queryPolicy: { strategy: "viewport" },
  detail: { fieldOrder: ["pitchClass", "sockets"] },
  actions: [
    { id: "provider", label: "Open provider", kind: "provider-action", providerId: "trail-partner" }
  ],
  attribution: [
    {
      label: "Trail Partner",
      url: "https://partner.example/terms",
      license: "Partner display terms"
    }
  ],
  capabilities: ["detail"]
};

describe("manifest-driven place detail", () => {
  it("offers exactly the five stable sections and hides empty optional ones", () => {
    assert.deepEqual(
      detailSurfaceOrder({ media: true, practical: true, social: true, more: true }),
      ["overview", "media", "practical", "social", "more"]
    );
    assert.deepEqual(
      detailSurfaceOrder({ media: false, practical: false, social: false, more: false }),
      ["overview"]
    );
  });

  it("renders only provider fields explicitly named by the manifest", () => {
    const fields = detailFieldsFromFeature(feature, manifest);
    assert.deepEqual(
      fields.map((item) => item.id),
      ["pitchClass", "sockets"]
    );
    assert.deepEqual(
      fields.map((item) => item.value),
      ["P", 4]
    );
    assert.ok(!fields.some((item) => item.id === "internalSecret"));
  });

  it("turns a provider action into a safe deep link without any login flow", () => {
    assert.deepEqual(detailActionsFromManifest(feature, manifest), [
      {
        id: "provider",
        label: "Open provider",
        kind: "open-url",
        sourceId: "trail-partner",
        url: "https://partner.example/stop/42",
        offlineAvailable: false
      }
    ]);
  });

  it("does not expose an action whose required runtime permission is unknown", () => {
    const protectedManifest: LayerManifestV2 = {
      ...manifest,
      actions: [
        {
          id: "write",
          label: "Provider write",
          kind: "provider-action",
          providerId: "trail-partner",
          requiresPermission: "provider.write"
        }
      ]
    };
    assert.deepEqual(detailActionsFromManifest(feature, protectedManifest), []);
  });

  it("keeps rights metadata advisory while requiring moderated and ready media", () => {
    const withMedia: GeoFeature = {
      ...feature,
      properties: {
        ...feature.properties,
        media: [
          {
            id: "ok",
            type: "image",
            url: "https://cdn.example/ok.jpg",
            sourceId: "trail-partner",
            sourceLabel: "Trail Partner",
            attribution: "Trail Partner / author",
            license: "CC-BY-4.0",
            moderationStatus: "approved",
            transformStatus: "ready"
          },
          {
            id: "unknown-rights",
            type: "image",
            url: "https://cdn.example/no.jpg",
            sourceId: "trail-partner",
            sourceLabel: "Trail Partner",
            moderationStatus: "approved",
            transformStatus: "ready"
          },
          {
            id: "pending",
            type: "image",
            url: "https://cdn.example/pending.jpg",
            sourceId: "trail-partner",
            sourceLabel: "Trail Partner",
            license: "CC-BY-4.0",
            moderationStatus: "pending",
            transformStatus: "ready"
          }
        ]
      }
    };
    assert.deepEqual(
      detailMediaFromFeature(withMedia, manifest).map((item) => item.id),
      ["ok", "unknown-rights"]
    );
  });

  // Commons, iNaturalist, Park4Night and the fused OSM places all send one URL on the feature
  // rather than a structured media list, which is why a card for a photograph used to show
  // everything about the photograph except the photograph.
  it("treats a plain photo URL on the feature as the hero image, with its credit", () => {
    const photo: GeoFeature = {
      ...feature,
      properties: {
        ...feature.properties,
        photo: "https://upload.example/thumb.jpg",
        author: "Jane Mapper",
        license: "CC-BY-SA-4.0",
        website: "https://commons.example/File:Thumb.jpg"
      }
    };
    const [asset, ...rest] = detailMediaFromFeature(photo, manifest);
    assert.equal(rest.length, 0);
    assert.equal(asset!.url, "https://upload.example/thumb.jpg");
    assert.equal(asset!.attribution, "Jane Mapper");
    assert.equal(asset!.license, "CC-BY-SA-4.0");
    assert.equal(asset!.sourceUrl, "https://commons.example/File:Thumb.jpg");
    assert.equal(asset!.sourceLabel, "Trail Partner");
  });

  it("prefers a structured media list, and never invents one from a bad URL", () => {
    const structured: GeoFeature = {
      ...feature,
      properties: {
        ...feature.properties,
        photo: "https://upload.example/flat.jpg",
        media: [
          {
            id: "ok",
            type: "image",
            url: "https://cdn.example/ok.jpg",
            sourceId: "trail-partner",
            sourceLabel: "Trail Partner",
            license: "CC-BY-4.0",
            moderationStatus: "approved",
            transformStatus: "ready"
          }
        ]
      }
    };
    assert.deepEqual(
      detailMediaFromFeature(structured, manifest).map((item) => item.url),
      ["https://cdn.example/ok.jpg"]
    );
    assert.deepEqual(
      detailMediaFromFeature(
        { ...feature, properties: { ...feature.properties, photo: "javascript:alert(1)" } },
        manifest
      ),
      []
    );
  });

  it("blocks executable URLs and only creates exact OSM correction links", () => {
    assert.equal(safeExternalUrl("javascript:alert(1)"), null);
    assert.equal(osmCorrectionUrl("node/123"), "https://www.openstreetmap.org/edit?node=123");
    assert.equal(osmCorrectionUrl("123"), null);
  });
});

test("provider timestamps read as dates, and non-dates are left alone", () => {
  assert.equal(formatDetailDate("2026-09-25", "cs-CZ"), "25. 9. 2026");
  assert.match(formatDetailDate("2026-09-25T14:05:00Z", "en-GB") ?? "", /25 Sept 2026, \d{2}:05/);
  assert.equal(formatDetailDate("active", "cs-CZ"), null);
  assert.equal(formatDetailDate(42, "cs-CZ"), null);
});

test("field labels follow the UI language and cover the Prague open-data fields", () => {
  setActiveLocale("cs");
  assert.equal(detailFieldLabel("district"), "Městská část");
  assert.equal(detailFieldLabel("properties.updatedAt"), "Aktualizováno");
  setActiveLocale("en");
  assert.equal(detailFieldLabel("updatedAt"), "Updated");
  assert.equal(detailFieldLabel("someNewField"), "Some New Field");
});
