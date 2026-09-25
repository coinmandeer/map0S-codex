import maplibregl from "maplibre-gl";
import type { GeoFeature } from "@mapos/layer-sdk";
import { PIN_STYLES } from "../ui/presets";
import { interactivePinOwner } from "./interactivePins";
import "./pinPreview.css";

export function previewUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** One DOM popup, no resolver, fetch, remote image or provider SDK on hover. */
export function createPinPreview(
  map: maplibregl.Map,
  open: (layer: string, feature: GeoFeature) => void
) {
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    focusAfterOpen: false,
    offset: 20,
    maxWidth: "280px",
    className: "mapos-pin-preview"
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  let identity = "";
  const hide = () => {
    clearTimeout(timer);
    clearTimeout(closeTimer);
    identity = "";
    held = false;
    popup.remove();
  };
  const leave = () => {
    clearTimeout(timer);
    closeTimer = setTimeout(() => {
      if (!held) hide();
    }, 180);
  };
  const show = (hit: maplibregl.MapGeoJSONFeature) => {
    const layer = interactivePinOwner(map, hit.layer.id);
    if (!layer || hit.geometry.type !== "Point") return;
    const props = hit.properties ?? {};
    const key = `${layer}:${props.id ?? hit.id}`;
    clearTimeout(closeTimer);
    if (identity === key) return;
    hide();
    identity = key;
    const coordinates = hit.geometry.coordinates as [number, number];
    timer = setTimeout(() => {
      const root = document.createElement("div");
      root.className = "pin-preview-card";
      root.setAttribute("aria-label", String(props.name ?? "Místo"));
      root.addEventListener("mouseenter", () => {
        held = true;
        clearTimeout(closeTimer);
      });
      root.addEventListener("mouseleave", () => {
        held = false;
        leave();
      });
      root.addEventListener("focusin", () => {
        held = true;
      });
      root.addEventListener("focusout", () => {
        held = false;
        leave();
      });
      const style = PIN_STYLES[String(props.category)] ?? PIN_STYLES.default;
      const icon = document.createElement("span");
      icon.className = "pin-preview-logo";
      icon.textContent = style?.icon ?? "📍";
      icon.setAttribute("aria-hidden", "true");
      root.append(icon);
      const title = document.createElement("button");
      title.type = "button";
      title.className = "pin-preview-title";
      title.textContent = String(props.name ?? "Místo");
      const detail = () => {
        hide();
        open(layer, {
          type: "Feature",
          geometry: { type: "Point", coordinates },
          properties: {
            ...props,
            id: props.id ?? String(hit.id),
            name: String(props.name ?? "Místo"),
            layerId: layer
          }
        });
      };
      title.addEventListener("click", detail);
      root.append(title);
      const subtitle = document.createElement("small");
      subtitle.textContent = style?.label ?? String(props.category ?? layer);
      root.append(subtitle);
      const rating = Number(props.rating),
        scale = Number(props.ratingScale);
      if (Number.isFinite(rating) && scale > 0 && props.ratingProvider) {
        const label = document.createElement("span");
        label.textContent = `★ ${rating}/${scale} · ${props.ratingProvider}${props.ratingCount ? ` (${props.ratingCount})` : ""}`;
        root.append(label);
      }
      const links = document.createElement("nav");
      links.setAttribute("aria-label", "Odkazy místa");
      for (const [field, label] of [
        ["website", "Web ↗"],
        ["instagram", "Instagram ↗"],
        ["facebook", "Facebook ↗"]
      ] as const) {
        const url = previewUrl(props[field]);
        if (!url) continue;
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = label;
        links.append(a);
      }
      root.append(links);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Detail";
      button.addEventListener("click", detail);
      root.append(button);
      popup.setLngLat(coordinates).setDOMContent(root).addTo(map);
    }, 150);
  };
  const keydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") hide();
  };
  document.addEventListener("keydown", keydown);
  map.on("movestart", hide);
  map.on("style.load", hide);
  return {
    show,
    leave,
    hide,
    destroy() {
      hide();
      document.removeEventListener("keydown", keydown);
      map.off("movestart", hide);
      map.off("style.load", hide);
    }
  };
}
