import type { Bbox, GeoFeature } from "@mapos/layer-sdk";
import { bboxCenter } from "../dataSources/types.js";

/** Where one live traffic answer came from. Attribution travels with each feature because the
 *  vessel layer can be served by two providers with different coverage and licences. */
export interface LiveTrafficSource {
  id: string;
  label: string;
  url: string;
  license: string;
}

export interface LiveTrafficResult {
  features: GeoFeature[];
  /** Partial means the answer is real but incomplete — a capped radius, a regional provider or
   *  a source that reported missing parts. The client says so instead of pretending. */
  status: "complete" | "partial";
  notice?: string;
  source: LiveTrafficSource;
  fetchedAt: string;
}

export const ADSB_LOL: LiveTrafficSource = {
  id: "adsblol",
  label: "ADSB.lol",
  url: "https://adsb.lol",
  license: "ODbL 1.0"
};

export const AISSTREAM: LiveTrafficSource = {
  id: "aisstream",
  label: "AISstream",
  url: "https://aisstream.io",
  license: "free stream, licence to be confirmed by the operator"
};

export const DIGITRAFFIC: LiveTrafficSource = {
  id: "digitraffic",
  label: "Digitraffic (Fintraffic)",
  url: "https://www.digitraffic.fi/en/marine-traffic/",
  license: "CC BY 4.0"
};

/** Parses and bounds-checks the `bbox=w,s,e,n` query used by both live endpoints. */
export function parseBbox(raw: string | undefined): Bbox | null {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [west, south, east, north] = parts as Bbox;
  if (west < -180 || east > 180 || south < -85 || north > 85) return null;
  if (west >= east || south >= north) return null;
  return [west, south, east, north];
}

/** Great-circle metres; the maps are small enough that the equirectangular form would be too
 *  coarse for a radius decision, and this is called a handful of times per request. */
export function distanceM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** Distance from the viewport centre to its farthest corner — the radius a provider has to
 *  cover for the answer not to be a lie about the edges of the screen. */
export function bboxCornerRadiusM(bbox: Bbox): number {
  const { lng, lat } = bboxCenter(bbox);
  const [west, south, east, north] = bbox;
  return Math.max(
    distanceM(lng, lat, east, north),
    distanceM(lng, lat, east, south),
    distanceM(lng, lat, west, north),
    distanceM(lng, lat, west, south)
  );
}
