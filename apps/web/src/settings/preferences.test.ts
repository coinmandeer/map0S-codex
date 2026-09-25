import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_USER_PREFERENCES,
  USER_PREFERENCES_STORAGE_KEY,
  loadUserPreferences,
  parseUserPreferences,
  persistUserPreferences,
  resolveThemePreference
} from "./preferences";

describe("typed user preferences", () => {
  it("parses known values and falls back field-by-field for malformed input", () => {
    assert.deepEqual(
      parseUserPreferences({
        theme: "dark",
        density: "tiny",
        locale: "en",
        units: "imperial",
        flyAnimations: false,
        manualRefresh: true,
        aiEnabled: false,
        aiAutoSummary: true
      }),
      {
        theme: "dark",
        lowData: false,
        density: DEFAULT_USER_PREFERENCES.density,
        locale: "en",
        units: "imperial",
        flyAnimations: false,
        manualRefresh: true,
        aiEnabled: false,
        aiAutoSummary: true
      }
    );
  });

  it("migrates the old theme when the versioned bundle does not exist", () => {
    const storage = { getItem: () => null };
    assert.equal(loadUserPreferences(storage, "light").theme, "light");
  });

  it("writes and reads one versioned settings envelope", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };
    const next = { ...DEFAULT_USER_PREFERENCES, density: "compact" as const };
    persistUserPreferences(storage, next);
    assert.equal(JSON.parse(values.get(USER_PREFERENCES_STORAGE_KEY)!).version, 1);
    assert.deepEqual(loadUserPreferences(storage), next);
  });

  it("resolves system theme without changing the stored preference", () => {
    assert.equal(resolveThemePreference("system", true), "dark");
    assert.equal(resolveThemePreference("system", false), "light");
    assert.equal(resolveThemePreference("light", true), "light");
  });
});

it("low data is opt-in, validated and persisted", () => {
  assert.equal(parseUserPreferences({}).lowData, false);
  assert.equal(parseUserPreferences({ lowData: "true" }).lowData, false);
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
  persistUserPreferences(storage, { ...DEFAULT_USER_PREFERENCES, lowData: true });
  assert.equal(loadUserPreferences(storage).lowData, true);
});
