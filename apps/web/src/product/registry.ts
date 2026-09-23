import type {
  ExperienceId,
  ExperienceManifest,
  GameManifest,
  LayerMode,
  LayerModeV2,
  SurfaceManifest
} from "@mapos/layer-sdk";
import { t } from "../i18n";
import type { IconName } from "../ui/kit/icons";

export type AppMode = LayerModeV2;
export type LegacyAppMode = "mine" | "weather" | "poi";
export type AppModeInput = AppMode | LegacyAppMode;

export interface ModeManifest {
  id: AppMode;
  label: string;
  shortLabel: string;
  description: string;
  /** A Material Symbols Rounded name from `ui/kit/icons.ts`. */
  icon: IconName;
  testId: `mode-${AppMode}`;
}

/** The single shell-mode registry. Layers and surfaces deliberately have their own registries.
 *
 *  The top bar, the mobile navigation bar and the history handling all read this list rather than
 *  hard-coding its length, which is how Feed (§13.2) became one entry plus a panel.
 *
 *  The three copy fields are getters, not strings: this list is built once at import time, and a
 *  string would freeze the labels in whichever language was active then. A getter is read at
 *  render time, so switching language relabels the mode bar without rebuilding the registry. */
export const MODE_MANIFESTS: readonly ModeManifest[] = [
  {
    id: "personal",
    get label() {
      return t("mode.personal");
    },
    get shortLabel() {
      return t("mode.personal.short");
    },
    get description() {
      return t("mode.personal.description");
    },
    icon: "person_pin_circle",
    testId: "mode-personal"
  },
  {
    id: "feed",
    get label() {
      return t("mode.feed");
    },
    get shortLabel() {
      return t("mode.feed.short");
    },
    get description() {
      return t("mode.feed.description");
    },
    icon: "dynamic_feed",
    testId: "mode-feed"
  },
  {
    id: "discover",
    get label() {
      return t("mode.discover");
    },
    get shortLabel() {
      return t("mode.discover.short");
    },
    get description() {
      return t("mode.discover.description");
    },
    icon: "explore",
    testId: "mode-discover"
  },
  {
    id: "planning",
    get label() {
      return t("mode.planning");
    },
    get shortLabel() {
      return t("mode.planning.short");
    },
    get description() {
      return t("mode.planning.description");
    },
    icon: "route",
    testId: "mode-planning"
  },
  {
    id: "game",
    get label() {
      return t("mode.game");
    },
    get shortLabel() {
      return t("mode.game.short");
    },
    get description() {
      return t("mode.game.description");
    },
    icon: "stadia_controller",
    testId: "mode-game"
  }
];

export interface AppModeResolution {
  mode: AppMode;
  activateLayerId?: string;
  source: "canonical" | "legacy" | "fallback";
  rewriteUrl: boolean;
}

const APP_MODE_IDS = new Set<AppMode>(MODE_MANIFESTS.map(({ id }) => id));

export function isAppMode(value: unknown): value is AppMode {
  return typeof value === "string" && APP_MODE_IDS.has(value as AppMode);
}

/**
 * Resolves old public links and callers, and keeps anything not in the registry out of state.
 * Weather remains additive: its old route lands in Discover and switches the weather layer on.
 */
export function resolveAppMode(value: unknown, fallback: AppMode = "discover"): AppModeResolution {
  if (isAppMode(value)) {
    return { mode: value, source: "canonical", rewriteUrl: false };
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (isAppMode(normalized)) {
      return { mode: normalized, source: "canonical", rewriteUrl: normalized !== value };
    }
    if (normalized === "mine") {
      return { mode: "personal", source: "legacy", rewriteUrl: true };
    }
    if (normalized === "weather") {
      return {
        mode: "discover",
        // Weather is a family of layers now; the old route lands on the radar one.
        activateLayerId: "weather-radar",
        source: "legacy",
        rewriteUrl: true
      };
    }
    if (normalized === "poi") {
      return { mode: "planning", source: "legacy", rewriteUrl: true };
    }
    // The mode was called Social while it was being designed, and links to it exist.
    if (normalized === "social") {
      return { mode: "feed", source: "legacy", rewriteUrl: true };
    }
    return { mode: fallback, source: "fallback", rewriteUrl: normalized.length > 0 };
  }

  return { mode: fallback, source: "fallback", rewriteUrl: false };
}

/**
 * Temporary bridge into v1 layer manifests while the shell already speaks canonical v2 IDs.
 *
 * Feed has no v1 equivalent and deliberately does not get one — widening the frozen v1 `LayerMode`
 * would change a type third-party plugins are compiled against. It reports as Discover so that v1
 * manifests still resolve for it; which layer Feed actually opens with is decided by
 * `primaryLayerForAppMode`, not here.
 */
export function legacyLayerModeFor(mode: AppMode): LayerMode {
  if (mode === "personal") return "mine";
  if (mode === "feed") return "discover";
  return mode;
}

const BUILTIN_EXPERIENCE_MANIFESTS: ExperienceManifest[] = [
  {
    id: "default",
    name: "Default",
    description: "Čistý MapOS pro cestování, objevování a komunitní mapy",
    icon: "public",
    accent: "#1e4fd8",
    recommendedIntegrationIds: ["osm-poi", "user-layers"],
    gameIds: []
  },
  {
    id: "global",
    name: "Global",
    icon: "public",
    accent: "#0891b2",
    description:
      "Světový přehled přírodních událostí. Lodě, letadla a orbitální pohled se připravují.",
    recommendedIntegrationIds: ["eonet", "earthquakes"],
    gameIds: []
  },
  {
    id: "aavegotchi",
    name: "Aavegotchi",
    description: "Gotchi avatar, questy, zóny a sběratelská hra nad mapou",
    icon: "stadia_controller",
    accent: "#7c3aed",
    recommendedIntegrationIds: ["osm-poi", "game"],
    gameIds: ["aavegotchi"],
    avatarProviderId: "aavegotchi"
  }
];

export interface ExperienceRegistry {
  register(manifest: ExperienceManifest): void;
  list(): readonly ExperienceManifest[];
  get(id: ExperienceId): ExperienceManifest;
}

/**
 * A world is data, not a shell branch. Integrations can register another manifest and immediately
 * participate in the selector, recommended-layer policy and experience-scoped layer filtering.
 */
export function createExperienceRegistry(
  initial: readonly ExperienceManifest[] = []
): ExperienceRegistry {
  const manifests = new Map<ExperienceId, ExperienceManifest>();

  const register = (manifest: ExperienceManifest) => {
    if (!manifest.id || manifests.has(manifest.id)) {
      throw new Error(`Experience already registered: ${manifest.id || "<empty>"}`);
    }
    manifests.set(manifest.id, manifest);
  };

  initial.forEach(register);
  return {
    register,
    list: () => [...manifests.values()],
    get: (id) => manifests.get(id) ?? manifests.values().next().value!
  };
}

export const experienceRegistry = createExperienceRegistry(BUILTIN_EXPERIENCE_MANIFESTS);

/** Snapshot kept for callers that only need the built-in worlds at module load. */
export const EXPERIENCE_MANIFESTS = experienceRegistry.list();

export const SURFACE_MANIFESTS: SurfaceManifest[] = [
  {
    id: "basemap",
    name: "Mapový podklad",
    kind: "basemap",
    description: "Ulice, turistická mapa, satelit nebo terén",
    exclusiveGroup: "base"
  },
  {
    id: "labels",
    name: "Popisky",
    kind: "labels",
    description: "Názvy míst nad obrazovým podkladem"
  },
  {
    id: "buildings-3d",
    name: "3D budovy",
    kind: "terrain",
    description: "Výšková data budov z vektorového podkladu"
  },
  {
    id: "weather",
    name: "Počasí a radar",
    kind: "weather",
    description: "Časové plošné meteorologické vizualizace",
    temporal: true
  }
];

export const GAME_MANIFESTS: GameManifest[] = [
  {
    id: "aavegotchi",
    name: "Aavegotchi QuestLayer",
    experienceIds: ["default", "aavegotchi"],
    maxEntities: 180,
    refreshIntervalMs: 30_000,
    temporal: true
  },
  {
    id: "trail-signals",
    name: "Trail Signals",
    experienceIds: ["default", "aavegotchi"],
    maxEntities: 24,
    refreshIntervalMs: 60_000,
    temporal: true
  }
];

export function experienceById(id: ExperienceId): ExperienceManifest {
  return experienceRegistry.get(id);
}

export function gameById(id: string): GameManifest | undefined {
  return GAME_MANIFESTS.find((game) => game.id === id);
}
