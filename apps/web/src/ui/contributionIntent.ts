import type { ContentDraftProvenance } from "@mapos/layer-sdk";

const STORAGE_KEY = "mapos:create-intent";

/** Which surface the user was on when they decided to contribute. It survives into the draft's
 *  provenance, so it has to name the real surface rather than be flattened to one of them. */
export interface ContributionIntent {
  source: "discover" | "feed";
  regionId?: string;
  regionName?: string;
}

/** @deprecated Kept as the old name while callers still say Discover. */
export type DiscoverContributionIntent = ContributionIntent;

export function rememberDiscoverContribution(intent: ContributionIntent): void {
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
    const value = JSON.parse(raw) as ContributionIntent;
    if (value.source !== "discover" && value.source !== "feed") return undefined;
    const surface = value.source === "feed" ? "Feed" : "Objevuj";
    return {
      kind: "user-contribution",
      source: value.source,
      sourceLabel: value.regionName
        ? `${surface} · ${value.regionName}`
        : `${surface} · aktuální výřez`,
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
