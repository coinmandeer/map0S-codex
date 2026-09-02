import type { GeoFeature } from "@mapos/layer-sdk";
import { fetchJson } from "../../utils/upstream.js";
import { bboxCenter, bboxSpanKm, point, withinBbox, type DataSource } from "./types.js";

/** Commons' geosearch caps its radius at 10 km, so this is centre-and-radius rather than bbox,
 *  and it declines to answer for a viewport wider than that. */
export const commonsPhotos: DataSource = {
  id: "commons-photos",
  tooLarge: (bbox) =>
    bboxSpanKm(bbox) > 20 ? "Přibliž mapu — fotky se hledají v okruhu do 10 km." : null,
  async load(bbox) {
    const { lng, lat } = bboxCenter(bbox);
    const radius = Math.min(10_000, Math.max(1000, (bboxSpanKm(bbox) / 2) * 1000));
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      generator: "geosearch",
      ggscoord: `${lat}|${lng}`,
      ggsradius: String(Math.round(radius)),
      ggslimit: "200",
      ggsnamespace: "6",
      prop: "imageinfo|coordinates",
      iiprop: "url|extmetadata",
      iiurlwidth: "320",
      // `coordinates` defaults to returning at most 10 pages' worth. Without this the layer
      // silently kept a handful of results and dropped the rest as "no coordinates".
      colimit: "max"
    });

    const data = await fetchJson<{
      query?: {
        pages?: Record<
          string,
          {
            pageid: number;
            title: string;
            coordinates?: Array<{ lat: number; lon: number }>;
            imageinfo?: Array<{
              thumburl?: string;
              descriptionurl?: string;
              extmetadata?: { Artist?: { value?: string }; LicenseShortName?: { value?: string } };
            }>;
          }
        >;
      };
    }>(`https://commons.wikimedia.org/w/api.php?${params}`, {
      providerId: "wikimedia-commons",
      ttlMs: 30 * 60_000
    });

    return Object.values(data.query?.pages ?? {}).flatMap((page): GeoFeature[] => {
      const coord = page.coordinates?.[0];
      const info = page.imageinfo?.[0];
      if (!coord || !info?.thumburl) return [];
      return [
        point(
          `commons:${page.pageid}`,
          page.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
          coord.lon,
          coord.lat,
          "commons-photos",
          {
            category: "photo",
            photo: info.thumburl,
            website: info.descriptionurl,
            // Commons images are free, but almost all of them still require attribution.
            author: info.extmetadata?.Artist?.value?.replace(/<[^>]*>/g, ""),
            license: info.extmetadata?.LicenseShortName?.value
          }
        )
      ];
    });
  }
};

/** Refuge Restrooms maps toilets that are safe and accessible for trans and disabled people —
 *  information no general POI source carries. Radius-based, like Commons. */
export const refugeRestrooms: DataSource = {
  id: "refuge-restrooms",
  tooLarge: (bbox) =>
    bboxSpanKm(bbox) > 100 ? "Přibliž mapu — toalety se hledají v okolí středu výřezu." : null,
  async load(bbox, query) {
    const { lng, lat } = bboxCenter(bbox);
    const params = new URLSearchParams({
      lat: lat.toFixed(5),
      lng: lng.toFixed(5),
      per_page: "100"
    });
    if (query.accessible === "true") params.set("ada", "true");
    if (query.unisex === "true") params.set("unisex", "true");

    const rows = await fetchJson<
      Array<{
        id: number;
        name?: string;
        street?: string;
        city?: string;
        accessible?: boolean;
        unisex?: boolean;
        changing_table?: boolean;
        directions?: string;
        comment?: string;
        latitude?: number;
        longitude?: number;
        upvote?: number;
        downvote?: number;
      }>
    >(`https://www.refugerestrooms.org/api/v1/restrooms/by_location.json?${params}`, {
      providerId: "refuge-restrooms",
      ttlMs: 60 * 60_000,
      // Their instance is a small volunteer deployment that regularly takes ten seconds or
      // more to answer; the default timeout turns a slow success into a failure.
      timeoutMs: 20_000
    });

    return rows.flatMap((r): GeoFeature[] => {
      if (r.latitude === undefined || r.longitude === undefined) return [];
      if (!withinBbox(bbox, r.longitude, r.latitude)) return [];
      return [
        point(
          `refuge:${r.id}`,
          r.name ?? "Veřejná toaleta",
          r.longitude,
          r.latitude,
          "refuge-restrooms",
          {
            category: "toilets",
            address: [r.street, r.city].filter(Boolean).join(", ") || undefined,
            accessible: r.accessible,
            unisex: r.unisex,
            changingTable: r.changing_table,
            directions: r.directions || undefined,
            note: r.comment || undefined,
            upvotes: r.upvote,
            downvotes: r.downvote,
            website: `https://www.refugerestrooms.org/restrooms/${r.id}`
          }
        )
      ];
    });
  }
};

export const communitySources: DataSource[] = [commonsPhotos, refugeRestrooms];
