import type { BasemapDefinition, BasemapGroup } from "@mapos/layer-sdk";

export const BASEMAP_GROUP_ORDER: readonly BasemapGroup[] = [
  "street",
  "outdoor",
  "satellite",
  "terrain",
  "historic",
  "national"
];

export interface BasemapGroupView {
  group: BasemapGroup;
  items: BasemapDefinition[];
}

/** Category membership comes exclusively from each basemap manifest's `group` field. */
export function groupBasemaps(
  basemaps: readonly BasemapDefinition[],
  order: readonly BasemapGroup[] = BASEMAP_GROUP_ORDER
): BasemapGroupView[] {
  const byGroup = new Map<BasemapGroup, BasemapDefinition[]>();
  for (const basemap of basemaps) {
    const items = byGroup.get(basemap.group) ?? [];
    items.push(basemap);
    byGroup.set(basemap.group, items);
  }
  return order.flatMap((group) => {
    const items = byGroup.get(group);
    return items?.length ? [{ group, items }] : [];
  });
}
