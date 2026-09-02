import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("AppShell composition", () => {
  it("owns exactly one MapCore outside the feature-flag branch", async () => {
    const [appSource, chromeSource] = await Promise.all([
      readFile(new URL("../../App.tsx", import.meta.url), "utf8"),
      readFile(new URL("./AppShell.tsx", import.meta.url), "utf8")
    ]);
    const mapTags = appSource.match(/<MapCore\s*\/>/g) ?? [];

    assert.equal(mapTags.length, 1);
    assert.ok(
      appSource.indexOf("<MapCore />") <
        appSource.indexOf("{APP_SHELL_V2_ENABLED ? (", appSource.indexOf("<MapCore />")),
      "the stable map precedes the v2/legacy chrome branch"
    );
    assert.equal(/<MapCore\b/.test(chromeSource), false, "chrome hosts cannot mount another map");
    assert.equal(
      /from\s+["'][^"']*MapCore["']/.test(chromeSource),
      false,
      "chrome hosts cannot import the map composition root"
    );
  });
});
