import type { MapAppearance } from "./mapAppearance";

/**
 * The config a chosen preset restored, remembered across reloads.
 *
 * Without this the preset badge is a claim the app forgets how to verify: after a reload the set
 * looked active but editing back to the preset's own values could no longer re-light it, and a
 * set that no longer matched still looked selected. Persisting the baseline makes "Custom" mean
 * "differs from what you last applied", which is what the user sees.
 */
const STORAGE_KEY = "mapos:preset-baseline-v1";

export interface PresetBaseline {
  id: string;
  appearance: MapAppearance;
}

function isAppearance(value: unknown): value is MapAppearance {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as MapAppearance).layers &&
    typeof (value as MapAppearance).layers === "object"
  );
}

export function readPresetBaseline(
  storage: Pick<Storage, "getItem"> | null
): PresetBaseline | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<PresetBaseline>;
    if (typeof candidate.id !== "string" || !isAppearance(candidate.appearance)) return null;
    return { id: candidate.id, appearance: candidate.appearance };
  } catch {
    return null;
  }
}

export function writePresetBaseline(
  storage: Pick<Storage, "setItem"> | null,
  value: PresetBaseline
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* Preset detection is an enhancement; denied storage must not break the layer controls. */
  }
}

export function clearPresetBaseline(storage: Pick<Storage, "removeItem"> | null): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
