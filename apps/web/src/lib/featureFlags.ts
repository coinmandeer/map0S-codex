const env = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env;
const value = env?.VITE_APP_SHELL_V2?.trim().toLowerCase();
const detailValue = env?.VITE_DETAIL_SURFACE_V2?.trim().toLowerCase();
const gameAvatarValue = env?.VITE_GAME_AVATAR_V2?.trim().toLowerCase();
const mapRuntimeValue = env?.VITE_MAP_RUNTIME_V2?.trim().toLowerCase();

/** New shell is the default; production can roll back without rebuilding any domain code. */
export const APP_SHELL_V2_ENABLED = value !== "0" && value !== "false";

/** The composition can roll back independently from the shell and without touching MapCore. */
export const DETAIL_SURFACE_V2_ENABLED = detailValue !== "0" && detailValue !== "false";

/** Disable to keep the existing game world while reverting the new avatar/inventory surface. */
export const GAME_AVATAR_V2_ENABLED = gameAvatarValue !== "0" && gameAvatarValue !== "false";

/** Disable only the shared lifecycle bridge; LayerEngine then uses its previous direct handles. */
export const MAP_RUNTIME_V2_ENABLED = mapRuntimeValue !== "0" && mapRuntimeValue !== "false";

/** Independent rollback of the local Discover polygons, retaining the legacy context overlay. */
const boundaryValue = env?.VITE_DISCOVER_BOUNDARIES?.trim().toLowerCase();
export const DISCOVER_BOUNDARIES_ENABLED = boundaryValue !== "0" && boundaryValue !== "false";
