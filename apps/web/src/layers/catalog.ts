import type { LayerCatalogEntry } from "@mapos/layer-sdk";
import { OSM_POI_CATEGORIES } from "@mapos/layer-sdk";

export const LAYER_CATALOG: LayerCatalogEntry[] = [
  {
    kind: "pins",
    manifest: {
      id: "osm-poi",
      name: "OSM POI",
      icon: "📍",
      color: "#3b82f6",
      description: "Hrady, vyhlídky, parkování, bary a další z OpenStreetMap",
      category: "travel"
    },
    filters: [
      {
        id: "categories",
        label: "Kategorie",
        kind: "multi-select",
        options: Object.entries(OSM_POI_CATEGORIES).map(([id, c]) => ({
          id,
          label: c.label
        })),
        default: ["castle", "viewpoint", "parking"]
      }
    ]
  },
  {
    kind: "pins",
    manifest: {
      id: "user-layers",
      name: "Moje vrstvy",
      icon: "✏️",
      color: "#10b981",
      description: "Vlastní piny a sdílené vrstvy",
      category: "user"
    }
  },
  {
    kind: "raster",
    manifest: {
      id: "weather",
      name: "Počasí",
      icon: "🌧️",
      color: "#6366f1",
      description: "Radar, teplota, vítr a další vrstvy",
      category: "weather"
    },
    filters: [
      {
        id: "opacity",
        label: "Průhlednost",
        kind: "range",
        min: 0.2,
        max: 1,
        default: 0.6
      }
    ]
  },
  {
    kind: "custom-gl",
    manifest: {
      id: "game",
      name: "QuestLayer",
      icon: "🎮",
      color: "#f59e0b",
      description: "3D questy, ghost zóny a Aavegotchi svět",
      category: "game"
    }
  },
  {
    kind: "pins",
    manifest: {
      id: "park4night",
      name: "Park4Night",
      icon: "🚐",
      color: "#0EA5A4",
      description: "Tábořiště a parkovací místa pro karavany (neoficiální zdroj, prototyp)",
      category: "travel",
      experimental: true
    }
  }
];

export function getLayerCatalogEntry(id: string): LayerCatalogEntry | undefined {
  return LAYER_CATALOG.find((l) => l.manifest.id === id);
}
