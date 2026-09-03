/**
 * Quests attached to real places.
 *
 * Deterministic spawning (see `spawn.ts`) makes the whole continent playable without a database,
 * but it puts objectives in fields and car parks because it only knows coordinates. Anchoring
 * borrows the map's own data: the quest lands on a castle, a viewpoint, a summit — somewhere
 * that was worth walking to before the game existed.
 *
 * The two coexist. Anchored quests appear where the map has something to anchor to; the derived
 * spawn keeps the world non-empty everywhere else.
 *
 * Adding a source of objectives means adding a `QuestSourceAdapter` — nothing else changes.
 */

import type { Bbox, GeoFeature } from "@mapos/layer-sdk";
import { distanceMeters } from "@mapos/layer-sdk";
import { hashString, mulberry32 } from "./spawn.js";

/** What the player is asked to do. The verb and the reward follow from this. */
export type QuestKind = "visit" | "cache" | "photo" | "survey" | "territory" | "summit";

/** A real-world place a quest can be attached to. */
export interface QuestAnchor {
  /** `${source}:${nativeId}` — the same shape places use, so an anchor is resolvable later. */
  ref: string;
  name: string;
  lng: number;
  lat: number;
  category: string;
  kind?: QuestKind;
  /** Some sources make attribution a licence condition: Opencaching requires a clickable link
   *  to the individual cache, so the link travels with the anchor. */
  externalUrl?: string;
  /** Overrides the category weight when the source knows better — a cache's difficulty, a
   *  Turf zone's point value. */
  weight?: number;
  /** How close counts as "there". Defaults to `COMPLETION_RADIUS_M`. */
  radiusM?: number;
  description?: string;
}

export interface AnchoredQuest {
  id: string;
  title: string;
  description: string;
  rewardPoints: number;
  lng: number;
  lat: number;
  kind: QuestKind;
  radiusM: number;
  externalUrl?: string;
  /** Which source produced it, so the UI can credit the data behind the objective. */
  sourceId: string;
  anchorRef: string;
  anchorName: string;
}

export interface QuestSourceAdapter {
  id: string;
  label: string;
  attribution: string;
  /** Why this source has nothing to offer right now — a missing API key, usually. Returning a
   *  string keeps it out of the registry's results without pretending the area is empty. */
  unavailableReason?(): string | null;
  /** How long a swept area stays trustworthy, for the cache in `questAnchorCache.ts`. A source
   *  whose data moves — open OSM notes get answered — wants a shorter window than one whose
   *  places have stood for centuries. Defaults to `DEFAULT_ANCHOR_REFRESH_MS`. */
  refreshAfterMs?: number;
  /** Candidate places in this viewport. Returning none is normal, not an error. */
  anchors(bbox: Bbox, limit: number): Promise<QuestAnchor[]>;
  /**
   * Re-reads one anchor by ref.
   *
   * A completion is verified against this, never against coordinates the client sent — otherwise
   * claiming a quest would just be a matter of posting the right numbers.
   */
  resolve(ref: string): Promise<QuestAnchor | null>;
}

/** How close a player must be to claim an anchored quest. Generous enough for consumer GPS
 *  drift in a city, tight enough that you have to actually be there. */
export const COMPLETION_RADIUS_M = 150;

/** Categories worth a detour, with how interesting each one is. The weight decides both the
 *  reward and which anchors win when a viewport has more than we want to show. */
export const ANCHOR_CATEGORIES: Record<string, { weight: number; verb: string }> = {
  castle: { weight: 5, verb: "Prozkoumej" },
  palace: { weight: 5, verb: "Navštiv" },
  ruins: { weight: 4, verb: "Najdi" },
  peak: { weight: 4, verb: "Vystoupej na" },
  viewpoint: { weight: 3, verb: "Dojdi na" },
  waterfall: { weight: 3, verb: "Najdi" },
  cave: { weight: 3, verb: "Prozkoumej" },
  museum: { weight: 2, verb: "Navštiv" },
  monument: { weight: 2, verb: "Najdi" },
  via_ferrata: { weight: 4, verb: "Zdolej" },
  climbing: { weight: 3, verb: "Zdolej" }
};

export const ANCHOR_CATEGORY_IDS = Object.keys(ANCHOR_CATEGORIES);

/** The registry is filled at startup by whichever storage the process runs on — the Postgres
 *  POI cache in the real server, the in-memory fixtures in the dev one — so the derivation
 *  below stays free of both. */
const ADAPTER_BY_ID = new Map<string, QuestSourceAdapter>();

export function registerQuestSource(adapter: QuestSourceAdapter): void {
  ADAPTER_BY_ID.set(adapter.id, adapter);
}

export function questSources(): QuestSourceAdapter[] {
  return [...ADAPTER_BY_ID.values()];
}

export function resetQuestSources(): void {
  ADAPTER_BY_ID.clear();
}

/** Ids travel as URL path params, so the ref is encoded — an OSM ref contains a colon, and a
 *  Wikidata one could contain worse. The tilde separates the two halves because both a source
 *  id and base64url may contain hyphens, which would make the split ambiguous. */
export function anchoredQuestId(sourceId: string, ref: string): string {
  return `anchor-${sourceId}~${Buffer.from(ref).toString("base64url")}`;
}

export function parseAnchoredQuestId(
  id: string
): { adapter: QuestSourceAdapter; ref: string } | null {
  const match = id.match(/^anchor-([a-z0-9-]+)~([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  const adapter = ADAPTER_BY_ID.get(match[1]!);
  if (!adapter) return null;
  try {
    const ref = Buffer.from(match[2]!, "base64url").toString("utf8");
    return ref ? { adapter, ref } : null;
  } catch {
    return null;
  }
}

/** The same anchor always yields the same quest text and reward. Deterministic rather than
 *  random so a player who walks away and comes back finds the objective they left. */
export function deriveQuest(
  adapter: Pick<QuestSourceAdapter, "id">,
  anchor: QuestAnchor
): AnchoredQuest {
  const meta = ANCHOR_CATEGORIES[anchor.category] ?? { weight: 1, verb: "Navštiv" };
  const kind = anchor.kind ?? "visit";
  const rand = mulberry32(hashString(anchor.ref));
  const weight = anchor.weight ?? meta.weight;
  const rewardPoints = Math.round(weight * 10 * (0.8 + rand() * 0.4));
  const radiusM = anchor.radiusM ?? COMPLETION_RADIUS_M;

  return {
    id: anchoredQuestId(adapter.id, anchor.ref),
    title: `${KIND_VERBS[kind] ?? meta.verb} ${anchor.name}`,
    description: anchor.description ?? `Dojdi na místo (do ${radiusM} m) a potvrď splnění.`,
    rewardPoints,
    lng: anchor.lng,
    lat: anchor.lat,
    kind,
    radiusM,
    externalUrl: anchor.externalUrl,
    sourceId: adapter.id,
    anchorRef: anchor.ref,
    anchorName: anchor.name
  };
}

/** A quest kind carries its own verb; only plain visits fall back to the category's. */
const KIND_VERBS: Partial<Record<QuestKind, string>> = {
  cache: "Najdi keš",
  photo: "Vyfoť",
  survey: "Zmapuj",
  territory: "Zaber",
  summit: "Vystoupej na"
};

/**
 * Quests for what is actually in this viewport, asking every source directly.
 *
 * Ranked by how interesting the anchor is, then capped — a city centre holds hundreds of
 * candidates and a quest list of hundreds is not a quest list.
 *
 * The live path. Serving the map from this would call four third-party APIs on every pan, so
 * request handling goes through `cachedAnchoredQuestsForBbox` instead and this stays as the
 * uncached primitive the sweep is built on.
 */
export async function anchoredQuestsForBbox(bbox: Bbox, limit = 12): Promise<AnchoredQuest[]> {
  const results = await Promise.all(
    questSources().map(async (adapter) => {
      if (adapter.unavailableReason?.()) return [];
      try {
        const anchors = await adapter.anchors(bbox, limit);
        return anchors.map((anchor) => deriveQuest(adapter, anchor));
      } catch {
        // One dead source must not empty the quest list.
        return [];
      }
    })
  );

  return results
    .flat()
    .sort((a, b) => b.rewardPoints - a.rewardPoints)
    .slice(0, limit);
}

/**
 * An anchor as a map feature for the `game-quests` layer.
 *
 * Shaped here rather than beside either store, because the Postgres server reads anchors from
 * the sweep cache and the offline server reads them from fixtures, and both have to produce
 * pins that look and behave identically.
 */
export function anchoredQuestFeature(
  adapter: Pick<QuestSourceAdapter, "id" | "label" | "attribution">,
  anchor: QuestAnchor
): GeoFeature {
  const quest = deriveQuest(adapter, anchor);
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [anchor.lng, anchor.lat] },
    properties: {
      id: quest.id,
      name: anchor.name,
      category: anchor.category,
      layerId: "game-quests",
      description: quest.description,
      questTitle: quest.title,
      rewardPoints: quest.rewardPoints,
      questKind: quest.kind,
      radiusM: quest.radiusM,
      sourceId: adapter.id,
      sourceLabel: adapter.label,
      attribution: adapter.attribution,
      ...(quest.externalUrl ? { externalUrl: quest.externalUrl } : {})
    }
  };
}

/** Why an empty viewport is empty, when every source needs a key we do not have. An area with
 *  no quests and an area we cannot ask about look identical on the map otherwise. */
export function unavailableSourcesNotice(): string | undefined {
  const blocked = questSources()
    .map((adapter) => ({ adapter, reason: adapter.unavailableReason?.() }))
    .filter((entry) => entry.reason);
  if (!blocked.length || blocked.length < questSources().length) return undefined;
  return blocked.map((entry) => `${entry.adapter.label}: ${entry.reason}`).join(" · ");
}

export interface AnchorVerification {
  quest: AnchoredQuest;
  distanceM: number;
  withinRange: boolean;
}

/** Checks a claim against the source's own copy of the place. */
export async function verifyAnchoredQuest(
  questId: string,
  at: { lng: number; lat: number }
): Promise<AnchorVerification | null> {
  const parsed = parseAnchoredQuestId(questId);
  if (!parsed) return null;
  const anchor = await parsed.adapter.resolve(parsed.ref);
  if (!anchor) return null;

  const quest = deriveQuest(parsed.adapter, anchor);
  const distanceM = distanceMeters(at, anchor);
  return {
    quest,
    distanceM,
    withinRange: distanceM <= quest.radiusM
  };
}
