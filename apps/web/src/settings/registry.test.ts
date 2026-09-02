import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SettingsUiRegistry } from "./registry";

describe("settings UI registry", () => {
  it("adds a later preference without changing a renderer switch", () => {
    const registry = new SettingsUiRegistry<{ prefix: string }, string>()
      .registerSection({ id: "map", title: "Mapa", icon: "map", order: 20 })
      .register({ id: "units", sectionId: "map", order: 20, render: (ctx) => `${ctx.prefix} km` })
      .register({
        id: "fixture-third-party",
        sectionId: "map",
        order: 30,
        render: (ctx) => `${ctx.prefix} fixture`
      });

    assert.deepEqual(
      registry.list()[0]?.entries.map((entry) => entry.render({ prefix: "MapOS" })),
      ["MapOS km", "MapOS fixture"]
    );
  });

  it("rejects duplicates and entries in unknown sections", () => {
    const registry = new SettingsUiRegistry<null, null>().registerSection({
      id: "ui",
      title: "UI",
      icon: "settings",
      order: 1
    });
    registry.register({ id: "theme", sectionId: "ui", order: 1, render: () => null });
    assert.throws(
      () => registry.register({ id: "theme", sectionId: "ui", order: 2, render: () => null }),
      /Duplicate setting/
    );
    assert.throws(
      () => registry.register({ id: "future", sectionId: "missing", order: 1, render: () => null }),
      /Unknown settings section/
    );
  });
});
