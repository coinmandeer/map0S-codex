import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDisplayableDetailMedia, type DetailMediaAsset } from "./info.js";

const valid: DetailMediaAsset = {
  id: "commons:file-1",
  kind: "photo",
  url: "https://upload.wikimedia.org/example.jpg",
  sourceId: "commons",
  sourceLabel: "Wikimedia Commons",
  attribution: "Jane Example / Wikimedia Commons",
  license: "CC-BY-SA-4.0",
  moderationStatus: "approved",
  transformStatus: "ready"
};

describe("detail media technical display gate", () => {
  it("keeps rights metadata advisory while requiring moderation and readiness", () => {
    assert.equal(isDisplayableDetailMedia(valid), true);
    assert.equal(isDisplayableDetailMedia({ ...valid, license: "" }), true);
    assert.equal(isDisplayableDetailMedia({ ...valid, attribution: "" }), true);
    assert.equal(isDisplayableDetailMedia({ ...valid, moderationStatus: "pending" }), false);
    assert.equal(isDisplayableDetailMedia({ ...valid, transformStatus: "processing" }), false);
  });

  it("rejects executable and malformed URLs", () => {
    assert.equal(isDisplayableDetailMedia({ ...valid, url: "javascript:alert(1)" }), false);
    assert.equal(isDisplayableDetailMedia({ ...valid, url: "not a URL" }), false);
  });
});
