import { Popup } from "maplibre-gl";
import type { Map, MapMouseEvent, ExpressionSpecification } from "maplibre-gl";
import type { MapResultArtifact } from "@mapos/layer-sdk";
import { artifactSnapshot, subscribeArtifacts } from "../ui/ai/artifactState";
import { emit, on } from "../lib/events";
const CATEGORY_COLORS = [
  "#2563eb",
  "#d97706",
  "#059669",
  "#9333ea",
  "#dc2626",
  "#0891b2",
  "#be185d",
  "#65a30d"
];
export function artifactColor(artifact: MapResultArtifact): string | ExpressionSpecification {
  const style = artifact.style;
  if (style.palette === "categories" && !style.categories?.length) return "#64748b";
  if (style.palette === "categories")
    return [
      "match",
      ["get", "category"],
      ...(style.categories ?? []).flatMap((category) => [
        category,
        CATEGORY_COLORS[
          [...category].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) %
            CATEGORY_COLORS.length
        ]!
      ]),
      "#64748b"
    ] as unknown as ExpressionSpecification;
  if (style.minimum === undefined || style.maximum === undefined) return "#2563eb";
  const stops =
    style.palette === "diverging"
      ? [
          style.minimum,
          "#2166ac",
          style.midpoint ?? (style.minimum + style.maximum) / 2,
          "#f7f7f7",
          style.maximum,
          "#b2182b"
        ]
      : [style.minimum, "#dbeafe", style.maximum, "#1e40af"];
  return [
    "case",
    ["==", ["get", "value"], null],
    "#9ca3af",
    ["interpolate", ["linear"], ["get", "value"], ...stops]
  ] as ExpressionSpecification;
}
/** Only a fixed, application-owned style vocabulary reaches MapLibre. */
export function attachArtifactOverlay(map: Map) {
  let sources: string[] = [];
  let layers: string[] = [];
  let pending = true;
  let highlighted: { source: string; id: string }[] = [];
  const clearHighlight = () => {
    for (const target of highlighted)
      if (map.getSource(target.source)) map.setFeatureState(target, { hover: false });
    highlighted = [];
  };
  const offHighlight = on("ai-result-hover", (ref) => {
    clearHighlight();
    if (!ref) return;
    for (const [index, artifact] of artifactSnapshot().entries()) {
      const source = `mapos-ai-artifact-${index}`;
      if (!map.getSource(source)) continue;
      for (const feature of artifact.data.features) {
        if (
          feature.properties.layerId !== ref.layerId ||
          feature.properties.sourceFeatureId !== ref.featureId
        )
          continue;
        const target = { source, id: feature.id };
        map.setFeatureState(target, { hover: true });
        highlighted.push(target);
      }
    }
  });
  const popup = new Popup({ closeButton: true, closeOnClick: true });
  const legend = document.createElement("div");
  legend.className = "map-artifact-legend";
  legend.hidden = true;
  map.getContainer().append(legend);
  const refresh = () => {
    pending = true;
    if (!map.isStyleLoaded()) return;
    pending = false;
    clearHighlight();
    popup.remove();
    for (const id of layers) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of sources) if (map.getSource(id)) map.removeSource(id);
    sources = [];
    layers = [];
    legend.replaceChildren();
    for (const [i, artifact] of artifactSnapshot().entries()) {
      // Registered rasters use the catalogue renderer and its authoritative colour legend.
      if (artifact.registeredRaster) continue;
      const source = `mapos-ai-artifact-${i}`;
      sources.push(source);
      map.addSource(source, { type: "geojson", data: artifact.data });
      const color = artifactColor(artifact),
        opacity = artifact.style.opacity;
      const definitions = [
        {
          id: `${source}-fill`,
          type: "fill" as const,
          filter: ["==", ["geometry-type"], "Polygon"] as ExpressionSpecification,
          paint: {
            "fill-color": color,
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              opacity,
              opacity * 0.5
            ] as ExpressionSpecification
          }
        },
        {
          id: `${source}-line`,
          type: "line" as const,
          filter: ["!=", ["geometry-type"], "Point"] as ExpressionSpecification,
          paint: {
            "line-color": color,
            "line-opacity": opacity,
            "line-width": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              6,
              3
            ] as ExpressionSpecification
          }
        },
        {
          id: `${source}-point`,
          type: "circle" as const,
          filter: ["==", ["geometry-type"], "Point"] as ExpressionSpecification,
          paint: {
            "circle-color": color,
            "circle-opacity": opacity,
            "circle-radius": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              12,
              7
            ] as ExpressionSpecification,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2
          }
        }
      ];
      for (const definition of definitions) {
        map.addLayer({ ...definition, source });
        layers.push(definition.id);
      }
      const entry = document.createElement("details"),
        title = document.createElement("summary"),
        description = document.createElement("p");
      title.textContent = artifact.title;
      const l = artifact.legend;
      description.textContent = [
        l
          ? `${l.title} (${l.unit}), ${l.time}. ${artifact.style.minimum ?? ""} – ${artifact.style.maximum ?? ""}. Šedá: ${l.noDataLabel}.`
          : null,
        ...artifact.sources.map((s) => s.label),
        artifact.derived?.description
      ]
        .filter(Boolean)
        .join(" · ");
      entry.append(title, description);
      if (l && artifact.style.minimum !== undefined && artifact.style.maximum !== undefined) {
        const scale = document.createElement("div");
        scale.className = "map-artifact-scale";
        scale.setAttribute(
          "aria-label",
          `${artifact.style.minimum} až ${artifact.style.maximum} ${l.unit}`
        );
        scale.style.height = "8px";
        const midpoint =
          artifact.style.midpoint ?? (artifact.style.minimum + artifact.style.maximum) / 2;
        const middle =
          (100 * (midpoint - artifact.style.minimum)) /
          (artifact.style.maximum - artifact.style.minimum);
        scale.style.background =
          artifact.style.palette === "diverging"
            ? `linear-gradient(to right, #2166ac, #f7f7f7 ${middle}%, #b2182b)`
            : "linear-gradient(to right, #dbeafe, #1e40af)";
        entry.append(scale);
      }
      for (const category of artifact.style.categories ?? []) {
        const label = document.createElement("div"),
          swatch = document.createElement("span");
        swatch.textContent = "■ ";
        swatch.style.color =
          CATEGORY_COLORS[
            [...category].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) %
              CATEGORY_COLORS.length
          ]!;
        label.append(swatch, document.createTextNode(category));
        entry.append(label);
      }
      for (const source of artifact.sources)
        if (source.url) {
          const link = document.createElement("a");
          link.textContent = source.label;
          link.href = source.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          entry.append(link, document.createTextNode(" "));
        }
      legend.append(entry);
    }
    legend.hidden = !artifactSnapshot().some((artifact) => !artifact.registeredRaster);
  };
  const click = (e: MapMouseEvent) => {
    const ids = layers.filter((id) => Boolean(map.getLayer(id)));
    if (!ids.length) return;
    const feature = map.queryRenderedFeatures(e.point, { layers: ids })[0],
      p = feature?.properties;
    if (p?.layerId && p?.sourceFeatureId)
      emit("ai-pin-hover", { layerId: String(p.layerId), featureId: String(p.sourceFeatureId) });
    if (feature && p) {
      const index = Number(String(feature.source).replace("mapos-ai-artifact-", ""));
      const artifact = artifactSnapshot()[index];
      if (!artifact) return;
      const body = document.createElement("div");
      const heading = document.createElement("strong");
      heading.textContent = String(p.title ?? artifact.title);
      body.append(heading);
      if (artifact.legend) {
        const value = document.createElement("p");
        value.textContent = `${typeof p.value === "number" ? p.value.toLocaleString() : "Bez dat"} ${artifact.legend.unit} · ${artifact.legend.time}`;
        body.append(value);
      }
      const source = artifact.sources.find((s) => s.id === p.sourceId);
      if (source?.url) {
        const link = document.createElement("a");
        link.textContent = "Zdroj údajů";
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        body.append(link);
      }
      popup.setLngLat(e.lngLat).setDOMContent(body).addTo(map);
    }
  };
  const off = subscribeArtifacts(refresh);
  const flushPending = () => {
    if (pending) refresh();
  };
  map.on("style.load", refresh);
  map.on("idle", flushPending);
  map.on("click", click);
  refresh();
  return () => {
    off();
    offHighlight();
    clearHighlight();
    map.off("style.load", refresh);
    map.off("idle", flushPending);
    map.off("click", click);
    popup.remove();
    legend.remove();
    for (const id of layers) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of sources) if (map.getSource(id)) map.removeSource(id);
  };
}
