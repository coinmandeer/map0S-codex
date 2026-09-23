import type { FilterValues } from "@mapos/layer-sdk";

export const LAYER_SESSION_STORAGE_KEY = "mapos:layer-session-v2";
const MAX_BYTES = 524_288;
const MAX_LAYERS = 1024;
const SENSITIVE_KEY =
  /(?:^|[-_])(bbox|center|coord|geometry|lat|latitude|lng|location|longitude|owner|user)(?:$|[-_])/i;

export interface LayerSessionEntry {
  visible: boolean;
  selected?: boolean;
  opacity: number;
  filters: FilterValues;
}

export type LayerSessionState = Record<string, LayerSessionEntry>;

function safeValue(value: unknown, depth = 0): unknown {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return value.slice(0, 256);
  if (depth >= 2) return undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) => safeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 32)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const safe = safeValue(item, depth + 1);
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}

function safeFilters(value: unknown): FilterValues {
  const safe = safeValue(value);
  return safe && typeof safe === "object" && !Array.isArray(safe) ? (safe as FilterValues) : {};
}

export function readLayerSessionState(storage: Pick<Storage, "getItem"> | null): LayerSessionState {
  if (!storage) return {};
  try {
    const raw =
      storage.getItem(LAYER_SESSION_STORAGE_KEY) ?? storage.getItem("mapos:layer-session-v1");
    if (!raw || raw.length > MAX_BYTES) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: LayerSessionState = {};
    for (const [id, entry] of Object.entries(parsed).slice(0, MAX_LAYERS)) {
      if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id) || !entry || typeof entry !== "object") {
        continue;
      }
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.visible !== "boolean") continue;
      const opacity = Number(candidate.opacity);
      result[id] = {
        visible: candidate.visible,
        selected: candidate.selected !== false,
        opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1,
        filters: safeFilters(candidate.filters)
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function writeLayerSessionState(
  storage: Pick<Storage, "setItem"> | null,
  activeLayers: Record<
    string,
    { visible: boolean; selected?: boolean; opacity: number; filters: FilterValues }
  >
): void {
  if (!storage) return;
  const safe: LayerSessionState = {};
  for (const [id, entry] of Object.entries(activeLayers).slice(0, MAX_LAYERS)) {
    if (entry.selected === false || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id)) continue;
    safe[id] = {
      visible: entry.visible,
      selected: true,
      opacity: Number.isFinite(entry.opacity) ? Math.min(1, Math.max(0, entry.opacity)) : 1,
      filters: safeFilters(entry.filters)
    };
  }
  try {
    const serialized = JSON.stringify(safe);
    if (serialized.length <= MAX_BYTES) storage.setItem(LAYER_SESSION_STORAGE_KEY, serialized);
  } catch {
    /* Session persistence is an enhancement; storage denial must not break layer controls. */
  }
}
