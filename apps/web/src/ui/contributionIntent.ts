import type { ContentDraftProvenance } from "@mapos/layer-sdk";

const STORAGE_KEY = "mapos:create-intent";

export interface DiscoverContributionIntent {
  source: "discover";
  regionId?: string;
  regionName?: string;
}

export function rememberDiscoverContribution(intent: DiscoverContributionIntent): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Private browsing may deny storage; the wizard still opens as a normal contribution form.
  }
}

export function readContributionProvenance(): ContentDraftProvenance | undefined {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as DiscoverContributionIntent;
    if (value.source !== "discover") return undefined;
    return {
      kind: "user-contribution",
      source: "discover",
      sourceLabel: value.regionName ? `Objevuj · ${value.regionName}` : "Objevuj · aktuální výřez",
      ...(value.regionId ? { regionId: value.regionId } : {}),
      ...(value.regionName ? { regionName: value.regionName } : {}),
      capturedAt: new Date().toISOString()
    };
  } catch {
    return undefined;
  }
}

export function clearContributionIntent(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // No cleanup is required when storage is unavailable.
  }
}
