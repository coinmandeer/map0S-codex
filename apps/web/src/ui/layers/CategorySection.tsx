import { presentationLabel } from "../../i18n/presentation";
import { useMemo, useState } from "react";
import type { OsmPoiCategoryId } from "@mapos/layer-sdk";
import { OSM_POI_CATEGORIES } from "@mapos/layer-sdk";
import { t } from "../../i18n";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Accordion, Button, Chip } from "../kit";
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
export function CategorySection({
  query = "",
  onlyActive = false
}: { query?: string; onlyActive?: boolean } = {}) {
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const matches = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .includes(query);
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
    store.setLayerFilters("osm-poi", {
      ...store.activeLayers["osm-poi"]?.filters,
      categories: next
    });
  };

  return (
    <div className="category-groups">
      <Accordion
        testId="category-groups"
        value={query ? groups.map((group) => group.id) : openGroups}
        onValueChange={setOpenGroups}
        sections={groups.flatMap((original) => {
          const label = presentationLabel("group", original.id, original.label);
          const options = original.options.filter(
            ([id, meta]) =>
              (!query ||
                matches(
                  `${presentationLabel("category", id, meta.label)} ${meta.label} ${label} ${original.label}`
                )) &&
              (!onlyActive ||
                Boolean(active["osm-poi"]?.visible && categories.includes(id as OsmPoiCategoryId)))
          );
          if (!options.length) return [];
          const ids = options.map(([id]) => id as OsmPoiCategoryId);
          const allOn = ids.every((id) => categories.includes(id));
          return [
            {
              id: original.id,
              title: label,
              count: original.options.filter(([id]) => categories.includes(id as OsmPoiCategoryId))
                .length,
              action: (
                <Button
                  variant="text"
                  size="sm"
                  testId={`category-group-toggle-${original.id}`}
                  onClick={() =>
                    write(
                      allOn
                        ? categories.filter((id) => !ids.includes(id))
                        : [...new Set([...categories, ...ids])]
                    )
                  }
                >
                  {allOn ? t("action.clear") : t("action.selectAll")}
                </Button>
              ),
              children: (
                <div className="category-chips">
                  {options.map(([id, meta]) => {
                    const categoryId = id as OsmPoiCategoryId;
                    const selected = categories.includes(categoryId);
                    return (
                      <Chip
                        key={id}
                        label={presentationLabel("category", id, meta.label)}
                        icon={poiCategoryIcon(id)}
                        active={selected && Boolean(active["osm-poi"]?.visible)}
                        testId={`filter-${id}`}
                        onClick={() =>
                          write(
                            selected && active["osm-poi"]?.visible
                              ? categories.filter((value) => value !== categoryId)
                              : [...new Set([...categories, categoryId])]
                          )
                        }
                      />
                    );
                  })}
                </div>
              )
            }
          ];
        })}
      />
    </div>
  );
}
