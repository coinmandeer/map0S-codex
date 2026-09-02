/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Set to `0`/`false` for an immediate rollback to the legacy chrome composition. */
  readonly VITE_APP_SHELL_V2?: string;
  /** Set to `0`/`false` to restore the legacy flat place-detail tabs. */
  readonly VITE_DETAIL_SURFACE_V2?: string;
  /** Set to `0`/`false` to keep the game world but use its pre-existing generic player. */
  readonly VITE_GAME_AVATAR_V2?: string;
  /** Set to `0`/`false` to restore direct layer handles without the shared style lifecycle. */
  readonly VITE_MAP_RUNTIME_V2?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    /** Dev-only handle to the MapLibre instance, for end-to-end tests that need to inspect what
     *  is attached to the map. Absent in production builds. */
    __maposMap?: import("maplibre-gl").Map;
    /** Dev-only handle to the game's three.js scene. The game draws into a custom WebGL layer, so
     *  "is the player there, are there dots" has no DOM answer either. Absent in production. */
    __maposGame?: import("./layers/game/GameHost").GameHost;
    /** Text snapshot consumed by the web-game audit client while the custom WebGL layer is live. */
    render_game_to_text?: () => string;
    /** Deterministic game-test hook used by the web-game audit client. */
    advanceTime?: (ms: number) => Promise<void>;
  }
}

export {};
