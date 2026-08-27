import type { LayerCategory } from "@mapos/layer-sdk";

/** Section headings for the layers menu. Grouping is what keeps the list readable as the
 *  registry grows — a flat list of twenty overlays is a wall nobody reads. */
export const LAYER_CATEGORY_LABELS: Record<LayerCategory, string> = {
  travel: "Cestování",
  outdoor: "Outdoor",
  transport: "Doprava",
  environment: "Příroda a prostředí",
  community: "Komunita",
  weather: "Počasí",
  game: "Hra",
  user: "Moje",
  routing: "Trasy"
};

/** Order the sections appear in. Anything missing falls to the end, so a new category shows up
 *  rather than disappearing. */
export const LAYER_CATEGORY_ORDER: LayerCategory[] = [
  "outdoor",
  "transport",
  "travel",
  "environment",
  "community",
  "weather",
  "game",
  "user",
  "routing"
];
