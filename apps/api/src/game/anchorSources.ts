/** Quest anchors backed by the Postgres POI cache. Kept apart from `anchors.ts` so the
 *  derivation logic — and the in-memory dev server that reuses it — never imports a database. */

import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { osmPois } from "../db/schema.js";
import {
  ANCHOR_CATEGORY_IDS,
  registerQuestSource,
  type QuestAnchor,
  type QuestSourceAdapter
} from "./anchors.js";
import { registerExternalQuestSources } from "./questSources.js";

function anchorFromRow(row: {
  osmId: string;
  name: string | null;
  lng: number;
  lat: number;
  category: string;
}): QuestAnchor | null {
  // An unnamed place makes a nonsense objective ("Prozkoumej Bez názvu"), so it is not an anchor.
  if (!row.name) return null;
  return {
    ref: `osm:${row.osmId}`,
    name: row.name,
    lng: row.lng,
    lat: row.lat,
    category: row.category
  };
}

/** Landmarks already in the POI cache. Free: the rows are there because somebody looked at this
 *  area on the map, so anchoring costs no upstream request. */
export const osmLandmarkSource: QuestSourceAdapter = {
  id: "osm-landmarks",
  label: "Významná místa z OSM",
  attribution: "© OpenStreetMap přispěvatelé (ODbL)",

  async anchors(bbox, limit) {
    const [w, s, e, n] = bbox;
    const rows = await db
      .select()
      .from(osmPois)
      .where(
        and(
          inArray(osmPois.category, ANCHOR_CATEGORY_IDS),
          isNotNull(osmPois.name),
          gte(osmPois.lng, w),
          lte(osmPois.lng, e),
          gte(osmPois.lat, s),
          lte(osmPois.lat, n)
        )
      )
      .limit(limit * 4);

    return rows.map(anchorFromRow).filter((a): a is QuestAnchor => a !== null);
  },

  async resolve(ref) {
    if (!ref.startsWith("osm:")) return null;
    const [row] = await db
      .select()
      .from(osmPois)
      .where(eq(osmPois.osmId, ref.slice(4)))
      .limit(1);
    return row ? anchorFromRow(row) : null;
  }
};

export function registerDbQuestSources(): void {
  registerQuestSource(osmLandmarkSource);
  registerExternalQuestSources();
}
