import type {
  ExperienceId,
  ExperienceManifest,
  GameManifest,
  LayerMode,
  LayerModeV2,
  SurfaceManifest
} from "@mapos/layer-sdk";

export type AppMode = LayerModeV2;
export type LegacyAppMode = "mine" | "weather" | "poi";
export type AppModeInput = AppMode | LegacyAppMode;

export interface ModeManifest {
  id: AppMode;
  label: string;
  shortLabel: string;
  description: string;
  icon: "bookmark" | "compass" | "route" | "gamepad";
  testId: `mode-${AppMode}`;
}

/** The single shell-mode registry. Layers and surfaces deliberately have their own registries. */
export const MODE_MANIFESTS: readonly ModeManifest[] = [
  {
    id: "personal",
    label: "Personal",
    shortLabel: "Personal",
    description: "Profil, ranky, uložené trasy, místa a vlastní obsah",
    icon: "bookmark",
    testId: "mode-personal"
  },
  {
    id: "discover",
    label: "Discover",
    shortLabel: "Discover",
    description: "Regiony, lidé a zajímavá místa napříč Evropou",
    icon: "compass",
    testId: "mode-discover"
  },
  {
    id: "planning",
    label: "Plánování",
    shortLabel: "Plán",
    description: "Trasy, zastávky, vozidlo, náklady a podmínky po cestě",
    icon: "route",
    testId: "mode-planning"
  },
  {
    id: "game",
    label: "Hra",
    shortLabel: "Hra",
    description: "Souběžné mapové hry nad jedním hráčem a jednou mapou",
    icon: "gamepad",
    testId: "mode-game"
  }
];

export interface AppModeResolution {
  mode: AppMode;
  activateLayerId?: "weather";
  source: "canonical" | "legacy" | "fallback";
  rewriteUrl: boolean;
}

const APP_MODE_IDS = new Set<AppMode>(MODE_MANIFESTS.map(({ id }) => id));

export function isAppMode(value: unknown): value is AppMode {
  return typeof value === "string" && APP_MODE_IDS.has(value as AppMode);
}

/**
 * Resolves old public links and callers without allowing a fifth shell mode back into state.
 * Weather remains additive: its old route lands in Discover and switches the weather layer on.
 */
export function resolveAppMode(value: unknown, fallback: AppMode = "planning"): AppModeResolution {
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
        activateLayerId: "weather",
        source: "legacy",
        rewriteUrl: true
      };
    }
    if (normalized === "poi") {
      return { mode: "planning", source: "legacy", rewriteUrl: true };
    }
    return { mode: fallback, source: "fallback", rewriteUrl: normalized.length > 0 };
  }

  return { mode: fallback, source: "fallback", rewriteUrl: false };
}

/** Temporary bridge into v1 layer manifests while the shell already speaks canonical v2 IDs. */
export function legacyLayerModeFor(mode: AppMode): LayerMode {
  return mode === "personal" ? "mine" : mode;
}

const BUILTIN_EXPERIENCE_MANIFESTS: ExperienceManifest[] = [
  {
    id: "default",
    name: "Default",
    description: "Čistý MapOS pro cestování, objevování a komunitní mapy",
    icon: "◎",
    accent: "#b7791f",
    recommendedIntegrationIds: ["osm-poi", "user-layers"],
    gameIds: []
  },
  {
    id: "aavegotchi",
    name: "Aavegotchi",
    description: "Gotchi avatar, questy, zóny a sběratelská hra nad mapou",
    icon: "👻",
    accent: "#a855f7",
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

/** Snapshot kept for callers that only need the two built-in worlds at module load. */
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
