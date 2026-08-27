/** Import this, never `./registry` directly — the side-effect import below is what makes the
 *  registry non-empty. */
import "./builtins";

export { infoPanelsFor, allInfoPanels, registerInfoPanel, resetInfoPanels } from "./registry";
export type { InfoPanel, InfoPanelProps } from "./registry";
export { InfoEngine } from "./InfoEngine";
