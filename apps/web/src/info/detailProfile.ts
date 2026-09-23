import {
  OSM_POI_CATEGORIES,
  type OsmPoiCategoryId,
  type DetailFieldValue,
  type Place
} from "@mapos/layer-sdk";

/** Presentation rules belong to the host, independently of provider data availability. */
export function detailProfile(category: string, layerId?: string) {
  const group = OSM_POI_CATEGORIES[category as OsmPoiCategoryId]?.group;
  const primary = ["prakticke"];
  const dataFirst = [
    "earthquakes",
    "eonet",
    "webcams",
    "geology",
    "air-quality",
    "openaq",
    "inaturalist",
    "gbif"
  ].includes(layerId ?? "");
  if (layerId === "geology") primary.push("geologie");
  else if (!dataFirst) {
    if (["nature", "stay", "sport"].includes(group)) primary.push("pocasi");
    if (["nature", "culture"].includes(group)) primary.push("wikipedia");
  }
  return { primary, dataFirst };
}

export function orderDetailPanels<T extends { id: string }>(
  panels: T[],
  category: string,
  layerId?: string
) {
  const profile = detailProfile(category, layerId);
  // Identity, links and embeds are presented by the host once, outside provider sections.
  const hosted = new Set(["prehled", "souhrn", "mapy-okoli", "windy", "mapillary", "odkazy"]);
  const primary = profile.primary.flatMap((id) => panels.filter((panel) => panel.id === id));
  const secondary = panels.filter(
    (panel) => !hosted.has(panel.id) && !profile.primary.includes(panel.id)
  );
  return { ...profile, primary, secondary };
}

/** Keep provider-specific facts while avoiding an identical contact/elevation fact twice. */
export function uniqueProviderFields(fields: DetailFieldValue[], place: Place): DetailFieldValue[] {
  const known = new Set(
    [place.address, place.openingHours, place.phone, place.website, place.elevationM]
      .filter((value) => value !== undefined && value !== null && value !== "")
      .map(String)
  );
  const seen = new Set<string>();
  return fields.filter((field) => {
    const contact = /^(address|opening_?hours|phone|tel|website|ele|elevationM)$/i.test(field.id);
    if (contact && known.has(String(field.value))) return false;
    const key = `${field.label}\0${JSON.stringify(field.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
