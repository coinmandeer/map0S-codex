import type maplibregl from "maplibre-gl";
import { t } from "../i18n";

/**
 * A one-tap 3D switch next to the zoom buttons.
 *
 * The detailed switches (buildings, terrain) stay in the Basemaps drawer; this is the shortcut
 * people look for on the map itself. It turns both on together — terrain works over any
 * background, buildings only where the basemap carries outlines — and turns everything off again.
 */
export class Toggle3dControl implements maplibregl.IControl {
  private container: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private active = false;
  private hidden = false;

  constructor(private readonly onToggle: (next: boolean) => void) {}

  onAdd(): HTMLElement {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group mapos-3d-ctrl";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mapos-3d-toggle";
    button.textContent = "3D";
    button.style.fontWeight = "700";
    button.style.fontSize = "12px";
    button.setAttribute("data-testid", "map-toggle-3d");
    button.addEventListener("click", () => this.onToggle(!this.active));
    container.appendChild(button);
    this.container = container;
    this.button = button;
    this.render();
    return container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
    this.button = null;
  }

  setState(active: boolean, hidden = false): void {
    this.active = active;
    this.hidden = hidden;
    this.render();
  }

  private render(): void {
    if (!this.button || !this.container) return;
    const label = t("map.toggle3d");
    this.button.title = label;
    this.button.setAttribute("aria-label", label);
    this.button.setAttribute("aria-pressed", String(this.active));
    this.button.style.color = this.active ? "var(--color-primary, #2563eb)" : "";
    this.container.style.display = this.hidden ? "none" : "";
  }
}
