/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
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
  }
}

export {};
