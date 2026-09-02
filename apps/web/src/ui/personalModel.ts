import type { SavedPlaceV2 } from "@mapos/layer-sdk";

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  place: "Místa",
  viewpoint: "Vyhlídky",
  cafe: "Kavárny",
  restaurant: "Restaurace",
  camp_site: "Kempy",
  parking: "Parkování",
  lake: "Jezera",
  peak: "Vrcholy",
  castle: "Hrady"
};

export interface PersonalCategoryCount {
  id: string;
  label: string;
  count: number;
}

export function personalCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replaceAll("_", " ");
}

export function personalCategoryCounts(places: readonly SavedPlaceV2[]): PersonalCategoryCount[] {
  const counts = new Map<string, number>();
  for (const place of places) {
    counts.set(place.category, (counts.get(place.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count, label: personalCategoryLabel(id) }))
    .sort((left, right) => left.label.localeCompare(right.label, "cs"));
}

export function filterPersonalPlaces(
  places: readonly SavedPlaceV2[],
  search: string,
  category: string | null
): SavedPlaceV2[] {
  const query = search.trim().toLocaleLowerCase("cs");
  return places.filter((place) => {
    if (category && place.category !== category) return false;
    if (!query) return true;
    return [place.snapshot.title, place.note, ...place.tags]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase("cs").includes(query));
  });
}
