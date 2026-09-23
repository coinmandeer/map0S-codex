import type { Bbox, GeoFeature } from "@mapos/layer-sdk";
import type { LiveTrafficSource } from "./types.js";

/** AIS ship type codes (ITU-R M.1371) reduced to the groups a reader recognises. */
export function shipTypeLabel(code: number | undefined): string | undefined {
  if (code === undefined || !Number.isFinite(code)) return undefined;
  if (code >= 70 && code <= 79) return "Nákladní loď";
  if (code >= 80 && code <= 89) return "Tanker";
  if (code >= 60 && code <= 69) return "Osobní loď";
  if (code === 30) return "Rybářská loď";
  if (code === 31 || code === 32 || code === 52) return "Vlečné a pomocné plavidlo";
  if (code === 33 || code === 34) return "Bagr nebo plavidlo údržby";
  if (code === 35) return "Vojenská loď";
  if (code === 36) return "Plachetnice";
  if (code === 37) return "Rekreační plavidlo";
  if (code >= 40 && code <= 49) return "Rychlé plavidlo";
  if (code === 50 || code === 51 || code === 53 || code === 54 || code === 55 || code === 58)
    return "Služební plavidlo";
  if (code >= 1 && code <= 19) return "Záložní kategorie";
  if (code >= 20 && code <= 29) return "Plavidlo WIG";
  return "Jiné plavidlo";
}

/** AIS navigational status codes; unknown stays undefined rather than an invented state. */
export function navStatusLabel(code: number | undefined): string | undefined {
  switch (code) {
    case 0:
      return "Pluje motorem";
    case 1:
      return "Na kotvě";
    case 2:
      return "Neovladatelné";
    case 3:
      return "Omezená manévrovatelnost";
    case 4:
      return "Omezeno ponorem";
    case 5:
      return "U přístaviště";
    case 6:
      return "Na mělčině";
    case 7:
      return "Rybolov";
    case 8:
      return "Pluje na plachty";
    case 14:
      return "AIS-SART";
    default:
      return undefined;
  }
}

export interface ShipFields {
  mmsi: number;
  name: string;
  lng: number;
  lat: number;
  speedKt?: number;
  courseDeg?: number;
  headingDeg?: number;
  navStatus?: number;
  shipType?: number;
  imo?: number;
  callSign?: string;
  destination?: string;
  /** Seconds since the position report was received by the provider. */
  fixAgeSeconds?: number;
}

/** VesselFinder opens a detail page by IMO; without one the name is the only honest search key,
 *  because an MMSI-only URL is not a documented endpoint. */
export function vesselExternalUrl(fields: Pick<ShipFields, "imo" | "name">): string {
  if (fields.imo)
    return `https://www.vesselfinder.com/vessels/details/${encodeURIComponent(String(fields.imo))}`;
  return `https://www.vesselfinder.com/vessels?name=${encodeURIComponent(fields.name)}`;
}

export function shipFeature(fields: ShipFields, source: LiveTrafficSource): GeoFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [fields.lng, fields.lat] },
    properties: {
      id: `${source.id}:${fields.mmsi}`,
      name: fields.name,
      layerId: "live-vessels",
      category: "vessel",
      mmsi: String(fields.mmsi),
      imo: fields.imo ? String(fields.imo) : undefined,
      callSign: fields.callSign,
      shipType: shipTypeLabel(fields.shipType),
      speedKt:
        fields.speedKt !== undefined && fields.speedKt >= 0 && fields.speedKt < 102.3
          ? fields.speedKt
          : undefined,
      courseDeg:
        fields.courseDeg !== undefined && fields.courseDeg >= 0 && fields.courseDeg < 360
          ? fields.courseDeg
          : undefined,
      headingDeg:
        fields.headingDeg !== undefined && fields.headingDeg >= 0 && fields.headingDeg < 360
          ? fields.headingDeg
          : undefined,
      navStatus: navStatusLabel(fields.navStatus),
      destination: fields.destination,
      seenPosSeconds: fields.fixAgeSeconds,
      observedAt:
        fields.fixAgeSeconds !== undefined
          ? new Date(Date.now() - Math.max(0, fields.fixAgeSeconds) * 1000).toISOString()
          : undefined,
      sourceLabel: source.label,
      externalUrl: vesselExternalUrl(fields)
    }
  };
}

export function withinLiveBbox(bbox: Bbox, lng: number, lat: number): boolean {
  const [west, south, east, north] = bbox;
  return (
    (west <= east ? lng >= west && lng <= east : lng >= west || lng <= east) &&
    lat >= south &&
    lat <= north
  );
}
