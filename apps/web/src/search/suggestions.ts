import { isValidCoordinates, type Coordinates } from "./coordinates.js";
import type { RecentSearchEntry } from "./recentSearches.js";
import { containsControlCharacters } from "./textSafety.js";

export type EmptySuggestionAction =
  | { type: "search"; query: string }
  | { type: "locate-current" }
  | { type: "go-to-location"; coordinates: Coordinates }
  | { type: "open-map-picker" }
  | { type: "open-saved-places" }
  | { type: "new-plan" }
  | { type: "set-mode"; mode: string };

export interface EmptySuggestion {
  id: string;
  label: string;
  description?: string;
  action: EmptySuggestionAction;
}

export interface EmptySuggestionSection {
  id: "recent" | "location" | "quick-actions" | "mode";
  label: string;
  items: EmptySuggestion[];
}

export interface LocationSuggestionInput {
  label: string;
  coordinates: Coordinates;
}

export interface ModeSuggestionInput {
  id: string;
  label: string;
  description?: string;
  mode: string;
}

export type QuickActionId = "map-picker" | "saved-places" | "new-plan";

export interface EmptySuggestionOptions {
  recent?: readonly RecentSearchEntry[];
  maxRecent?: number;
  includeCurrentLocation?: boolean;
  lastLocation?: LocationSuggestionInput;
  quickActions?: readonly QuickActionId[];
  modes?: readonly ModeSuggestionInput[];
}

const QUICK_ACTIONS: Record<QuickActionId, EmptySuggestion> = {
  "map-picker": {
    id: "quick-map-picker",
    label: "Vybrat místo na mapě",
    action: { type: "open-map-picker" }
  },
  "saved-places": {
    id: "quick-saved-places",
    label: "Uložená místa",
    action: { type: "open-saved-places" }
  },
  "new-plan": {
    id: "quick-new-plan",
    label: "Nový plán",
    action: { type: "new-plan" }
  }
};

function cleanText(value: string, maximum = 160): string | null {
  if (containsControlCharacters(value)) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized && normalized.length <= maximum ? normalized : null;
}

/** Builds the no-query menu from already available local data. It never reads storage or network. */
export function buildEmptySuggestions(
  options: EmptySuggestionOptions = {}
): EmptySuggestionSection[] {
  const sections: EmptySuggestionSection[] = [];
  const requestedMaximum = options.maxRecent ?? 5;
  const maxRecent = Number.isFinite(requestedMaximum)
    ? Math.min(12, Math.max(0, Math.floor(requestedMaximum)))
    : 5;
  const recentItems: EmptySuggestion[] = [];
  const seenQueries = new Set<string>();
  for (const entry of maxRecent > 0 ? (options.recent ?? []) : []) {
    const query = cleanText(entry.query, 240);
    const label = cleanText(entry.label);
    const key = query?.toLocaleLowerCase("cs-CZ");
    if (!query || !label || !key || seenQueries.has(key)) continue;
    seenQueries.add(key);
    recentItems.push({
      id: `recent-${entry.id}`,
      label,
      description: "Nedávné hledání",
      action: { type: "search", query }
    });
    if (recentItems.length === maxRecent) break;
  }
  if (recentItems.length > 0) sections.push({ id: "recent", label: "Nedávné", items: recentItems });

  const locationItems: EmptySuggestion[] = [];
  if (options.includeCurrentLocation !== false) {
    locationItems.push({
      id: "location-current",
      label: "Moje poloha",
      action: { type: "locate-current" }
    });
  }
  const lastLabel = options.lastLocation ? cleanText(options.lastLocation.label) : null;
  if (options.lastLocation && lastLabel && isValidCoordinates(options.lastLocation.coordinates)) {
    locationItems.push({
      id: "location-last",
      label: lastLabel,
      description: "Naposledy použitá poloha",
      action: { type: "go-to-location", coordinates: { ...options.lastLocation.coordinates } }
    });
  }
  if (locationItems.length > 0) {
    sections.push({ id: "location", label: "Poloha", items: locationItems });
  }

  const requestedQuickActions = options.quickActions ?? ["map-picker", "saved-places", "new-plan"];
  const quickItems = [...new Set(requestedQuickActions)]
    .map((id) => QUICK_ACTIONS[id])
    .filter((item): item is EmptySuggestion => item !== undefined)
    .map((item) => ({ ...item, action: { ...item.action } }));
  if (quickItems.length > 0) {
    sections.push({ id: "quick-actions", label: "Rychlé akce", items: quickItems });
  }

  const seenModes = new Set<string>();
  const modeItems: EmptySuggestion[] = [];
  for (const mode of options.modes ?? []) {
    const id = cleanText(mode.id, 80);
    const label = cleanText(mode.label);
    const description = mode.description ? (cleanText(mode.description) ?? undefined) : undefined;
    const modeId = cleanText(mode.mode, 80);
    if (!id || !label || !modeId || seenModes.has(modeId)) continue;
    seenModes.add(modeId);
    modeItems.push({
      id: `mode-${id}`,
      label,
      ...(description ? { description } : {}),
      action: { type: "set-mode", mode: modeId }
    });
  }
  if (modeItems.length > 0) sections.push({ id: "mode", label: "Režimy", items: modeItems });
  return sections;
}
