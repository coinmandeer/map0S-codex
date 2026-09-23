import { ensureDataPinImage } from "../../map/pinIcons";
import { registerInteractivePins, unregisterInteractivePins } from "../../map/interactivePins";
import type maplibregl from "maplibre-gl";
import type { Bbox, FeatureCollection, FilterValues, LayerHandle } from "@mapos/layer-sdk";
import { registerLayer } from "../registry";

/**
 * Street objects recorded by Mapillary: road markings, traffic signs, benches, bike racks, poles,
 * hydrants and the rest of the street furniture its contributors photographed.
 *
 * The tiles come from our own origin (`/street-objects/...`), never directly from Mapillary: the
 * access token is a secret and proxying is what keeps it out of the browser, out of `Referer`, and
 * out of any URL that gets logged. The server reports `mapillary` as a capability only when it has
 * a token, so without one this layer is simply absent rather than broken.
 *
 * Mapillary splits the data into two tile sets — objects/road markings (`point`) and traffic signs
 * (`traffic_sign`) — and the catalogue presents them as several rows. Rather than download the same
 * tiles once per row, this is one layer whose facet picks which `object_value` classes are drawn.
 *
 * It does not use the shared `createVectorTileOverlay` group filter: that helper falls back to a
 * default group when none of the chosen groups exist in a source, which would make selecting only a
 * point category still draw traffic signs from the sign tile set. Here a sublayer draws if and only
 * if its category is in the selection.
 */

const OBJECT_SOURCE_LAYER = "point";
const SIGN_SOURCE_LAYER = "traffic_sign";

/** Colour and the `object_value` prefixes each category owns. Prefix matching is deliberate:
 *  Mapillary's values are structured (`object--traffic-light--general-upright`), so a prefix names
 *  a whole family without listing every member. */
const CATEGORIES = [
  {
    id: "signs",
    label: "Dopravní značky",
    color: "#dc2626",
    source: "sign",
    prefixes: [] as string[]
  },
  {
    id: "crossings",
    label: "Přechody a řízení dopravy",
    color: "#f59e0b",
    source: "point",
    prefixes: [
      "construction--flat--crosswalk",
      "marking--discrete--crosswalk",
      "object--traffic-light",
      "object--support--traffic-sign-frame",
      "marking--discrete--stop-line",
      "marking--discrete--give-way",
      "marking--discrete--arrow"
    ]
  },
  {
    id: "cycle",
    label: "Cyklistická infrastruktura",
    color: "#7c3aed",
    source: "point",
    prefixes: ["object--bike-rack", "marking--discrete--symbol--bicycle"]
  },
  {
    id: "power",
    label: "Elektřina",
    color: "#eab308",
    source: "point",
    prefixes: ["object--support--utility-pole", "object--support--pole", "object--catenary"]
  },
  {
    id: "network",
    label: "Sítě",
    color: "#8b5cf6",
    source: "point",
    prefixes: ["object--junction-box", "object--cctv-camera"]
  },
  {
    id: "water",
    label: "Voda a kanalizace",
    color: "#0ea5e9",
    source: "point",
    prefixes: ["object--catch-basin", "object--manhole", "object--fire-hydrant"]
  },
  {
    id: "furniture",
    label: "Vybavení veřejného prostoru",
    color: "#14b8a6",
    source: "point",
    prefixes: [
      "object--bench",
      "object--mailbox",
      "object--phone-booth",
      "object--sign--information",
      "object--sign--advertisement",
      "object--sign--store",
      "object--street-light",
      "object--parking-meter",
      "object--traffic-cone",
      "object--banner"
    ]
  }
] as const;

/** A MapLibre filter for one category: a `match` over the `object_value` the tile carries. Traffic
 *  signs are their own tile set, so a sign category matches everything in it. */
function categoryFilter(category: (typeof CATEGORIES)[number]): maplibregl.FilterSpecification {
  if (!category.prefixes.length) return ["has", "object_value"] as maplibregl.FilterSpecification;
  return [
    "any",
    ...category.prefixes.map((prefix) => [
      "==",
      ["slice", ["get", "object_value"], 0, prefix.length],
      prefix
    ])
  ] as unknown as maplibregl.FilterSpecification;
}

/** The categories the user has selected, as a set. Absent or empty means the facet's default, which
 *  is also what the layer starts with. */
function selectedCategories(filters: FilterValues): Set<string> {
  const raw = filters.categories;
  const values = (Array.isArray(raw) ? raw : [raw]).filter(
    (value): value is string => typeof value === "string"
  );
  return new Set(values.length ? values : ["signs", "crossings"]);
}

registerLayer({
  kind: "raster",
  minQueryZoom: 14,
  geometryKinds: ["Point", "VectorTile"],
  renderer: { type: "symbols" },
  areaFilter: "context",
  manifest: {
    id: "street-objects",
    name: "Objekty ulic",
    icon: "🛣️",
    color: "#dc2626",
    category: "community",
    requiresCapability: "mapillary",
    description:
      "Objekty a dopravní značky rozpoznané z fotografií Mapillary. Kreslí se až od zoomu 14; poloha vychází ze snímků, ne z terénního měření."
  },
  filters: [
    {
      id: "categories",
      label: "Třída objektu",
      kind: "multi-select",
      options: CATEGORIES.map((category) => ({ id: category.id, label: category.label })),
      default: ["signs", "crossings"]
    }
  ],
  defaultFilters: { categories: ["signs", "crossings"] },
  defaultOpacity: 0.9,
  legend: {
    type: "categorical",
    title: "Objekty ulic (Mapillary)",
    items: CATEGORIES.map((category) => ({ label: category.label, color: category.color }))
  },
  create: (ctx) => createStreetObjectsLayer(ctx.map, ctx.layerId, ctx.apiBaseUrl),
  attribution: [
    {
      label: "Mapillary (CC-BY-SA-4.0)",
      url: "https://www.mapillary.com/",
      license: "CC-BY-SA-4.0"
    }
  ]
});

function createStreetObjectsLayer(
  map: maplibregl.Map,
  layerId: string,
  apiBase: string
): LayerHandle {
  const sets = [
    {
      id: "point",
      tiles: `${apiBase}/street-objects/point/{z}/{x}/{y}`,
      sourceLayer: OBJECT_SOURCE_LAYER
    },
    {
      id: "sign",
      tiles: `${apiBase}/street-objects/sign/{z}/{x}/{y}`,
      sourceLayer: SIGN_SOURCE_LAYER
    }
  ] as const;

  let visible = true;
  let opacity = 0.9;
  let selected = selectedCategories({});

  const sourceId = (setId: string) => `source-street-${layerId}-${setId}`;
  const layerIdFor = (setId: string) => `street-${layerId}-${setId}`;

  function removeAll() {
    for (const set of sets) {
      for (const category of CATEGORIES.filter((c) => c.source === set.id)) {
        const id = `${layerIdFor(set.id)}-${category.id}`;
        unregisterInteractivePins(map, [id]);
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource(sourceId(set.id))) map.removeSource(sourceId(set.id));
    }
  }

  function ensureLayers() {
    const before = map.getStyle()?.layers?.find((layer) => layer.type === "symbol")?.id;
    for (const set of sets) {
      const sid = sourceId(set.id);
      const lid = layerIdFor(set.id);
      if (map.getLayer(lid)) continue;
      if (!map.getSource(sid)) {
        map.addSource(sid, {
          type: "vector",
          tiles: [set.tiles],
          minzoom: 14,
          maxzoom: 14,
          attribution: "Mapillary (CC-BY-SA-4.0)"
        });
      }
      const categories = CATEGORIES.filter(
        (category) => category.source === set.id && selected.has(category.id)
      );
      // One MapLibre layer per category: colour and radius are the category's, and the filter is
      // the family of `object_value`s it owns. An unselected category simply has no layer.
      for (const category of categories) {
        const id = `${layerIdFor(set.id)}-${category.id}`;
        const glyphs: Record<string, string> = {
          signs: "sign",
          crossings: "sign",
          cycle: "bicycle",
          power: "charging",
          network: "satellite",
          water: "drinking_water",
          furniture: "shelter"
        };
        ensureDataPinImage(map, id, category.color, glyphs[category.id]);
        registerInteractivePins(map, layerId, [id]);
        if (map.getLayer(id)) continue;
        map.addLayer(
          {
            id,
            type: "symbol",
            source: sid,
            "source-layer": set.sourceLayer,
            minzoom: 14,
            filter: categoryFilter(category),
            layout: {
              visibility: visible ? "visible" : "none",
              "icon-image": `pin-${id}`,
              "icon-size": 0.8,
              "icon-allow-overlap": false,
              "icon-padding": 3
            },
            paint: { "icon-opacity": opacity }
          } as maplibregl.LayerSpecification,
          before
        );
      }
    }
  }

  /** Rebuild the drawn layers when the selection changes; visibility and opacity are cheap to set
   *  in place, but which categories exist is not. */
  function applySelection() {
    for (const set of sets) {
      for (const category of CATEGORIES.filter((entry) => entry.source === set.id)) {
        const id = `${layerIdFor(set.id)}-${category.id}`;
        const shouldExist = selected.has(category.id);
        if (shouldExist && !map.getLayer(id)) {
          ensureLayers();
          return;
        }
        if (!shouldExist && map.getLayer(id)) {
          unregisterInteractivePins(map, [id]);
          map.removeLayer(id);
        }
      }
    }
  }

  function applyVisibility() {
    for (const set of sets) {
      for (const category of CATEGORIES) {
        const id = `${layerIdFor(set.id)}-${category.id}`;
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
      }
    }
  }

  function applyOpacity() {
    for (const set of sets) {
      for (const category of CATEGORIES) {
        const id = `${layerIdFor(set.id)}-${category.id}`;
        if (!map.getLayer(id)) continue;
        map.setPaintProperty(id, "icon-opacity", opacity);
      }
    }
  }

  return {
    async update(_bbox: Bbox, filters: FilterValues): Promise<FeatureCollection | null> {
      selected = selectedCategories(filters);
      ensureLayers();
      applySelection();
      applyVisibility();
      applyOpacity();
      // MapLibre fetches the tiles, so there is no feature list to return or cache.
      return null;
    },
    setVisible(next: boolean) {
      visible = next;
      applyVisibility();
    },
    setOpacity(next: number) {
      opacity = next;
      applyOpacity();
    },
    detach() {
      removeAll();
    }
  };
}
