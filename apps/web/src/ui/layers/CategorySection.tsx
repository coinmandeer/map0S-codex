import { useMemo } from "react";
import type { OsmPoiCategoryId } from "@mapos/layer-sdk";
import { OSM_POI_CATEGORIES } from "@mapos/layer-sdk";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Button, Chip } from "../kit";
import { CATEGORY_GROUPS } from "../presets";
import { poiCategoryIcon } from "./layerPresentation";

const FALLBACK_CATEGORIES: OsmPoiCategoryId[] = ["restaurant", "cafe", "parking", "viewpoint"];

export function selectedCategories(filters: Record<string, unknown> | undefined) {
  const value = filters?.categories;
  return Array.isArray(value) ? (value as OsmPoiCategoryId[]) : FALLBACK_CATEGORIES;
}

/** Which kinds of place the POI layer draws (§4.7 ④).
 *
 *  Chips rather than a list of checkboxes: with 36 categories in six groups the wrap keeps the
 *  whole taxonomy on about six lines, and a chip shows its own state without a second column.
 */
export function CategorySection() {
  const store = getMapStore();
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  const categories = selectedCategories(active["osm-poi"]?.filters);

  const groups = useMemo(
    () =>
      CATEGORY_GROUPS.map((group) => ({
        ...group,
        options: Object.entries(OSM_POI_CATEGORIES).filter(([, meta]) => meta.group === group.id)
      })).filter((group) => group.options.length > 0),
    []
  );

  const write = (next: OsmPoiCategoryId[]) => {
    if (!store.activeLayers["osm-poi"]?.visible) store.toggleLayer("osm-poi");
    store.setLayerFilters("osm-poi", { categories: next });
  };

  return (
    <div className="category-groups">
      {groups.map((group) => {
        const ids = group.options.map(([id]) => id as OsmPoiCategoryId);
        const allOn = ids.every((id) => categories.includes(id));
        return (
          <div className="category-group" key={group.id}>
            <div className="category-group-header">
              <span className="kit-eyebrow">{group.label}</span>
              <Button
                variant="text"
                size="sm"
                testId={`category-group-toggle-${group.id}`}
                onClick={() =>
                  write(
                    allOn
                      ? categories.filter((id) => !ids.includes(id))
                      : [...new Set([...categories, ...ids])]
                  )
                }
              >
                {allOn ? "Zrušit" : "Vybrat vše"}
              </Button>
            </div>
            <div className="category-chips">
              {group.options.map(([id, meta]) => {
                const categoryId = id as OsmPoiCategoryId;
                const selected = categories.includes(categoryId);
                return (
                  <Chip
                    key={id}
                    label={meta.label}
                    icon={poiCategoryIcon(id)}
                    active={selected}
                    testId={`filter-${id}`}
                    onClick={() =>
                      write(
                        selected
                          ? categories.filter((value) => value !== categoryId)
                          : [...categories, categoryId]
                      )
                    }
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
