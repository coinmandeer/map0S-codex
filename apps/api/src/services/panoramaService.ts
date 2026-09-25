import { config } from "../config.js";
import { fetchJson } from "../utils/upstream.js";

interface ImageRecord {
  id?: string;
  captured_at?: number;
  compass_angle?: number;
  is_pano?: boolean;
  sequence?: string;
  computed_geometry?: { coordinates?: number[] };
  geometry?: { coordinates?: number[] };
}

export interface StreetImage {
  imageId: string;
  distanceMeters: number;
  capturedAt: string | null;
  /** True when the capture is a 360° panorama rather than a flat frame. */
  isPano: boolean;
  /** Which drive/walk the frame belongs to, so a viewer can step along it. */
  sequence: string | null;
  /** Direction the camera faced, in degrees clockwise from north. */
  compassAngle: number | null;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,30}$/.test(value);
}

/** Every usable image within range, nearest first. The panorama panel uses the list so the
 *  reader can step along a sequence instead of only seeing the single closest frame. */
export function streetImages(rows: ImageRecord[], lng: number, lat: number): StreetImage[] {
  return rows
    .flatMap((row) => {
      const coordinates = row.computed_geometry?.coordinates ?? row.geometry?.coordinates;
      if (!validId(row.id) || !coordinates || coordinates.length < 2) return [];
      if (!coordinates.every(Number.isFinite)) return [];
      const [x, y] = coordinates as [number, number];
      const rad = Math.PI / 180;
      const a =
        Math.sin(((y - lat) * rad) / 2) ** 2 +
        Math.cos(lat * rad) * Math.cos(y * rad) * Math.sin(((x - lng) * rad) / 2) ** 2;
      const distance = 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
      if (distance > 200) return [];
      const capturedAt =
        row.captured_at &&
        Number.isFinite(row.captured_at) &&
        row.captured_at > 0 &&
        row.captured_at < 8.64e15
          ? new Date(row.captured_at).toISOString()
          : null;
      return [
        {
          imageId: row.id,
          distanceMeters: Math.round(distance),
          capturedAt,
          isPano: row.is_pano === true,
          sequence: typeof row.sequence === "string" && row.sequence ? row.sequence : null,
          compassAngle:
            typeof row.compass_angle === "number" && Number.isFinite(row.compass_angle)
              ? Math.round(row.compass_angle)
              : null
        }
      ];
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export function nearestStreetImage(
  rows: ImageRecord[],
  lng: number,
  lat: number
): StreetImage | null {
  return streetImages(rows, lng, lat)[0] ?? null;
}

/** The images near a point. `panoramasOnly` keeps the 360° captures, which is what the
 *  panorama viewer is for; the ordinary layer shows every frame. */
export async function streetPanorama(
  lng: number,
  lat: number,
  signal: AbortSignal,
  options: { panoramasOnly?: boolean } = {}
) {
  if (!config.layerKeys.mapillary) return { status: "unconfigured" as const };
  const dy = 200 / 111320;
  const dx = dy / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const bbox = [
    Math.max(-180, lng - dx),
    Math.max(-90, lat - dy),
    Math.min(180, lng + dx),
    Math.min(90, lat + dy)
  ];
  const data = await fetchJson<{ data?: ImageRecord[] }>(
    `https://graph.mapillary.com/images?bbox=${bbox.join(",")}&limit=100` +
      `&fields=id,captured_at,compass_angle,is_pano,sequence,computed_geometry,geometry`,
    {
      providerId: "mapillary",
      headers: { Authorization: `OAuth ${config.layerKeys.mapillary}` },
      signal,
      timeoutMs: 8000,
      ttlMs: 3600000,
      maxResponseBytes: 384000
    }
  );
  const images = streetImages(data.data ?? [], lng, lat);
  const filtered = options.panoramasOnly ? images.filter((image) => image.isPano) : images;
  const image = filtered[0] ?? null;
  return image
    ? { status: "ready" as const, ...image, images: filtered.slice(0, 20) }
    : { status: "empty" as const };
}

interface PanoramaxFeature {
  id?: string;
  collection?: string;
  geometry?: { coordinates?: number[] };
  properties?: {
    datetime?: string;
    license?: string;
    "view:azimuth"?: number;
    "geovisio:producer"?: string;
    "geovisio:status"?: string;
  };
  assets?: { hd?: { href?: string }; sd?: { href?: string }; thumb?: { href?: string } };
}

/** A nearby Panoramax picture, shaped like the Mapillary `StreetImage` so one panel can show
 *  either source without branching on where the frame came from. `imageId` is the viewer URL,
 *  because Panoramax opens a picture by its own page rather than an embed key. */
export function nearestPanoramaxPicture(
  features: PanoramaxFeature[],
  lng: number,
  lat: number,
  radiusM = 200
): (StreetImage & { viewerUrl: string; thumbnailUrl: string | null }) | null {
  const rad = Math.PI / 180;
  const candidates = features
    .flatMap((feature) => {
      const coords = feature.geometry?.coordinates;
      if (!feature.id || !coords || coords.length < 2 || !coords.every(Number.isFinite)) return [];
      if (feature.properties?.["geovisio:status"] !== "ready") return [];
      const [x, y] = coords as [number, number];
      const a =
        Math.sin(((y - lat) * rad) / 2) ** 2 +
        Math.cos(lat * rad) * Math.cos(y * rad) * Math.sin(((x - lng) * rad) / 2) ** 2;
      const distanceM = Math.round(6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a))));
      if (distanceM > radiusM) return [];
      return [
        {
          imageId: feature.id,
          distanceMeters: distanceM,
          capturedAt: feature.properties?.datetime ?? null,
          isPano: true,
          sequence: feature.collection ?? null,
          compassAngle:
            typeof feature.properties?.["view:azimuth"] === "number"
              ? Math.round(feature.properties["view:azimuth"])
              : null,
          viewerUrl: `https://api.panoramax.xyz/api/collections/${feature.collection}/items/${feature.id}`,
          thumbnailUrl: feature.assets?.thumb?.href ?? feature.assets?.sd?.href ?? null
        }
      ];
    })
    .sort((left, right) => left.distanceMeters - right.distanceMeters);
  return candidates[0] ?? null;
}

/** Street-level imagery from Panoramax near a point. Keyless, so unlike Mapillary there is no
 *  token to be missing: an empty answer means the federated instances have no coverage here. */
export async function panoramaxPanorama(lng: number, lat: number, signal: AbortSignal) {
  const dy = 200 / 111320;
  const dx = dy / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const bbox = [
    Math.max(-180, lng - dx),
    Math.max(-90, lat - dy),
    Math.min(180, lng + dx),
    Math.min(90, lat + dy)
  ];
  const data = await fetchJson<{ features?: PanoramaxFeature[] }>(
    `https://api.panoramax.xyz/api/search?bbox=${bbox.join(",")}&limit=100&sortby=datetime`,
    {
      providerId: "panoramax",
      signal,
      timeoutMs: 10_000,
      ttlMs: 3600000,
      maxResponseBytes: 2_000_000
    }
  );
  const picture = nearestPanoramaxPicture(data.features ?? [], lng, lat);
  return picture ? { status: "ready" as const, ...picture } : { status: "empty" as const };
}
