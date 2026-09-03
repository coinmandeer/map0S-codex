export const USER_PREFERENCES_STORAGE_KEY = "mapos:user-preferences-v1";

export type ThemePreference = "system" | "light" | "dark";
export type UiDensity = "comfortable" | "compact";
export type DistanceUnits = "metric" | "imperial";
export type UiLocale = "cs" | "en";

/**
 * One typed, versioned settings contract. New preferences are added here first and then get a
 * renderer entry in the UI registry; the settings drawer never needs a preference switch block.
 */
export interface UserPreferences {
  theme: ThemePreference;
  density: UiDensity;
  locale: UiLocale;
  units: DistanceUnits;
  flyAnimations: boolean;
  showSearchHere: boolean;
  aiEnabled: boolean;
  aiAutoSummary: boolean;
}

export const DEFAULT_USER_PREFERENCES: Readonly<UserPreferences> = {
  theme: "system",
  density: "comfortable",
  locale: "cs",
  units: "metric",
  flyAnimations: true,
  showSearchHere: true,
  aiEnabled: true,
  aiAutoSummary: true
};

interface StorageReader {
  getItem(key: string): string | null;
}

interface StorageWriter extends StorageReader {
  setItem(key: string, value: string): void;
}

const THEMES = new Set<ThemePreference>(["system", "light", "dark"]);
const DENSITIES = new Set<UiDensity>(["comfortable", "compact"]);
const LOCALES = new Set<UiLocale>(["cs", "en"]);
const UNITS = new Set<DistanceUnits>(["metric", "imperial"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function parseUserPreferences(value: unknown): UserPreferences {
  const raw = isRecord(value) && isRecord(value.preferences) ? value.preferences : value;
  const record = isRecord(raw) ? raw : {};
  return {
    theme: THEMES.has(record.theme as ThemePreference)
      ? (record.theme as ThemePreference)
      : DEFAULT_USER_PREFERENCES.theme,
    density: DENSITIES.has(record.density as UiDensity)
      ? (record.density as UiDensity)
      : DEFAULT_USER_PREFERENCES.density,
    locale: LOCALES.has(record.locale as UiLocale)
      ? (record.locale as UiLocale)
      : DEFAULT_USER_PREFERENCES.locale,
    units: UNITS.has(record.units as DistanceUnits)
      ? (record.units as DistanceUnits)
      : DEFAULT_USER_PREFERENCES.units,
    flyAnimations: booleanOr(record.flyAnimations, DEFAULT_USER_PREFERENCES.flyAnimations),
    showSearchHere: booleanOr(record.showSearchHere, DEFAULT_USER_PREFERENCES.showSearchHere),
    aiEnabled: booleanOr(record.aiEnabled, DEFAULT_USER_PREFERENCES.aiEnabled),
    aiAutoSummary: booleanOr(record.aiAutoSummary, DEFAULT_USER_PREFERENCES.aiAutoSummary)
  };
}

export function loadUserPreferences(
  storage: StorageReader | null,
  legacyTheme?: string | null
): UserPreferences {
  if (!storage) return { ...DEFAULT_USER_PREFERENCES };
  try {
    const stored = storage.getItem(USER_PREFERENCES_STORAGE_KEY);
    if (stored) return parseUserPreferences(JSON.parse(stored));
  } catch {
    /* A corrupt preference must not prevent the map from opening. */
  }
  const migrated = { ...DEFAULT_USER_PREFERENCES };
  if (legacyTheme === "light" || legacyTheme === "dark") migrated.theme = legacyTheme;
  return migrated;
}

export function persistUserPreferences(storage: StorageWriter | null, value: UserPreferences) {
  if (!storage) return;
  storage.setItem(
    USER_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ schema: "mapos.user-preferences", version: 1, preferences: value })
  );
}

export function resolveThemePreference(
  preference: ThemePreference,
  prefersDark: boolean
): "light" | "dark" {
  return preference === "system" ? (prefersDark ? "dark" : "light") : preference;
}
