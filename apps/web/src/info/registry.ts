import type { ComponentType } from "react";
import type { InfoPanelContext, InfoPanelDescriptor } from "@mapos/layer-sdk";

/** Everything a panel needs to render. Deliberately the same object `appliesTo` sees, so a
 *  panel can't be offered on grounds it then can't use. */
export type InfoPanelProps = InfoPanelContext;

export interface InfoPanel extends InfoPanelDescriptor {
  render: ComponentType<InfoPanelProps>;
}

const panels = new Map<string, InfoPanel>();

export function registerInfoPanel(panel: InfoPanel) {
  if (panels.has(panel.id)) {
    throw new Error(`Info panel "${panel.id}" is already registered`);
  }
  panels.set(panel.id, panel);
}

export function allInfoPanels(): InfoPanel[] {
  return [...panels.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/** The tabs this particular place earns. Order is stable across places so the same tab doesn't
 *  jump position as the user steps through nearby pins. */
export function infoPanelsFor(ctx: InfoPanelContext): InfoPanel[] {
  return allInfoPanels().filter((panel) => {
    try {
      return panel.appliesTo(ctx);
    } catch {
      return false;
    }
  });
}

export function resetInfoPanels() {
  panels.clear();
}
