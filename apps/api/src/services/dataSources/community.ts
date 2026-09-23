import type { GeoFeature } from "@mapos/layer-sdk";
import { fetchJson } from "../../utils/upstream.js";
import { bboxCenter, bboxSpanKm, point, withinBbox, type DataSource } from "./types.js";

/** Commons' geosearch caps its radius at 10 km, so this is centre-and-radius rather than bbox,
 *  and it declines to answer for a viewport wider than that. */
export const commonsPhotos: DataSource = {
  id: "commons-photos",
  tooLarge: (bbox) =>
    bboxSpanKm(bbox) > 20 ? "Přibliž mapu — fotky se hledají v okruhu do 10 km." : null,
  async load(bbox, _query, signal) {
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
      signal,
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
  async load(bbox, query, signal) {
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
      signal,
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

/** Street-level photographs from Panoramax, the open, federated alternative to Mapillary.
 *
 *  Reading is keyless: the STAC search endpoint answers a bbox with picture metadata. The
 *  federated aggregator (`api.panoramax.xyz`) fans out to national instances, so one request
 *  finds pictures wherever they were uploaded. Uploading would need an account, which is why
 *  this is read-only. */
export const panoramax: DataSource = {
  id: "panoramax",
  tooLarge: (bbox) =>
    bboxSpanKm(bbox) > 20 ? "Přibliž mapu — snímky ulic se načítají pro menší výřez." : null,
  async load(bbox, query, signal) {
    const panoOnly = query?.pano === "1" || query?.pano === "true";
    const params = new URLSearchParams({
      bbox: bbox.join(","),
      limit: "100",
      // `datetime` is the capture time; the newest view of a street is what a reader wants first.
      sortby: "datetime"
    });
    if (panoOnly) params.set("filter", "pers:interior_orientation.camera_model IS NOT NULL");

    const data = await fetchJson<{
      features?: Array<{
        id?: string;
        collection?: string;
        geometry?: { coordinates?: number[] };
        properties?: {
          datetime?: string;
          license?: string;
          "view:azimuth"?: number;
          "geovisio:producer"?: string;
          "geovisio:thumbnail"?: string;
          "geovisio:status"?: string;
        };
        assets?: { hd?: { href?: string }; sd?: { href?: string }; thumb?: { href?: string } };
        links?: Array<{ rel?: string; href?: string; type?: string }>;
      }>;
    }>(`https://api.panoramax.xyz/api/search?${params}`, {
      providerId: "panoramax",
      signal,
      ttlMs: 30 * 60_000
    });

    return (data.features ?? []).flatMap((feature): GeoFeature[] => {
      const coords = feature.geometry?.coordinates;
      if (!feature.id || !coords || coords.length < 2 || !coords.every(Number.isFinite)) return [];
      const [lng, lat] = coords as [number, number];
      if (!withinBbox(bbox, lng, lat)) return [];
      // Only ready pictures: one still processing has no usable asset yet.
      if (feature.properties?.["geovisio:status"] !== "ready") return [];
      const thumb = feature.assets?.thumb?.href;
      if (!thumb) return [];
      const viewer =
        feature.links?.find((link) => link.rel === "self")?.href ??
        `https://api.panoramax.xyz/api/collections/${feature.collection}/items/${feature.id}`;
      return [
        point(`panoramax:${feature.id}`, "Snímek ulice (Panoramax)", lng, lat, "panoramax", {
          category: "street-photo",
          photo: thumb,
          bearing: feature.properties?.["view:azimuth"],
          capturedAt: feature.properties?.datetime,
          author: feature.properties?.["geovisio:producer"],
          license: feature.properties?.license,
          website: viewer
        })
      ];
    });
  }
};

export const communitySources: DataSource[] = [commonsPhotos, refugeRestrooms, panoramax];
