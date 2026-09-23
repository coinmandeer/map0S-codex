import type { MapAppearance } from "../store/mapAppearance";
/**
 * Layer sets the user saved themselves.
 *
 * The four built-in presets answer "what are you doing today"; these answer "the combination I
 * always end up building by hand". They live in localStorage next to `mapos:last-preset` — the
 * set is small, private, and worth nothing to a server, and a saved set of layer ids stays
 * meaningful even if the account does not exist yet.
 */

const STORAGE_KEY = "mapos:user-presets";
/** A safety bound on how many sets are read back, not a policy of dropping the oldest. Saving at
 *  the bound is refused explicitly by the dialog; it never silently deletes a set the user kept. */
export const USER_PRESET_LIMIT = 64;

export interface UserPreset {
  id: string;
  name: string;
  layers: string[];
  version?: 2;
  appearance?: MapAppearance;
  /** Epoch millis of the last save. Used only for ordering; a set without one sorts first. */
  updatedAt?: number;
}

/** Reads the saved sets, ignoring anything that no longer parses as one. */
export function loadUserPresets(): UserPreset[] {
  if (typeof window === "undefined") return [];
  try {
    return parseUserPresets(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Separate from the storage call so the parsing rules are testable on their own. */
export function parseUserPresets(raw: string | null): UserPreset[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isUserPreset);
}

function isUserPreset(value: unknown): value is UserPreset {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<UserPreset>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.layers) &&
    candidate.layers.every((layer) => typeof layer === "string")
  );
}

/**
 * Adds a set, replacing one of the same name.
 *
 * Saving "Weekend" twice means the second one is what "Weekend" now is — two cards with the
 * same name and different contents would be a puzzle, not a shortcut.
 *
 * An existing set is only ever replaced by name; nothing is dropped for being old. The result is
 * ordered by recency (newest last) because every caller renders the array in order.
 */
export function withUserPreset(presets: readonly UserPreset[], next: UserPreset): UserPreset[] {
  const key = next.name.trim().toLocaleLowerCase();
  const kept = presets.filter((preset) => preset.name.trim().toLocaleLowerCase() !== key);
  return [...kept, next];
}

/** A readable order for the picker: a saved set's own timestamp when it has one, else catalogue
 *  order as written. Kept separate so the strip and any future list agree. */
export function sortUserPresets(presets: readonly UserPreset[]): UserPreset[] {
  return [...presets].sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
}

export function withoutUserPreset(presets: readonly UserPreset[], id: string): UserPreset[] {
  return presets.filter((preset) => preset.id !== id);
}

export function saveUserPresets(presets: readonly UserPreset[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

/** Ids are derived from the name so a set saved twice in one session cannot collide with
 *  itself, and stay stable enough to be a React key. */
export function userPresetId(name: string): string {
  const slug = name
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  return `user:${slug || "preset"}`;
}
