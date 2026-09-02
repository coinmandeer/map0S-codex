import type maplibregl from "maplibre-gl";

/** Mapy's licence requires their logo to stay visible on the map whenever their tiles are
 *  shown — including when only the label overlay is theirs. MapCore adds and removes it as the
 *  chosen background changes; see `usesMapyTiles` in the SDK for what counts as "shown". */
export class MapyLogoControl implements maplibregl.IControl {
  private container: HTMLDivElement | null = null;

  onAdd(): HTMLElement {
    const el = document.createElement("div");
    el.className = "maplibregl-ctrl mapy-logo-ctrl";
    const link = document.createElement("a");
    link.href = "https://mapy.com/";
    link.target = "_blank";
    link.rel = "noopener";
    link.setAttribute("aria-label", "Mapy.com");
    const img = document.createElement("img");
    img.src = "https://api.mapy.com/img/api/logo.svg";
    img.alt = "Mapy.com";
    img.width = 68;
    img.height = 18;
    link.appendChild(img);
    el.appendChild(link);
    this.container = el;
    return el;
  }

  onRemove() {
    this.container?.remove();
    this.container = null;
  }
}
