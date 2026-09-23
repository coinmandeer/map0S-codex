import type { Bbox } from "@mapos/layer-sdk";
import { fetchJson } from "../../utils/upstream.js";
import { shipFeature, withinLiveBbox } from "./ships.js";
import { DIGITRAFFIC, type LiveTrafficResult } from "./types.js";

/**
 * Ships in Finnish waters from Fintraffic's Digitraffic (CC BY 4.0, commercial use allowed).
 *
 * This is the keyless maritime source: the coverage is honestly stated as regional, which is
 * why the vessel layer prefers AISstream whenever an operator has configured a key and falls
 * back to Finland for everyone else. The API requires an identifying User header and compressed
 * responses — both are set here, not left to defaults.
 */

const USER_HEADER = "MapOS/LiveLayers 1.0";
/** Digitraffic's AIS area covers Finnish waters; a viewport that does not touch it gets an
 *  empty, explained answer instead of a provider round trip. */
const COVERAGE: Bbox = [19.0, 58.5, 32.0, 70.5];
const LOCATIONS_TTL_MS = 20_000;
const VESSELS_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_VESSELS = 600;

interface LocationFeature {
  mmsi?: number;
  geometry?: { coordinates?: number[] };
  properties?: {
    mmsi?: number;
    sog?: number;
    cog?: number;
    heading?: number;
    navStat?: number;
    timestampExternal?: number;
  };
}

interface VesselMeta {
  mmsi?: number;
  name?: string;
  imo?: number;
  callSign?: string;
  destination?: string;
  shipType?: number;
}

function overlaps(bbox: Bbox, area: Bbox): boolean {
  return bbox[0] <= area[2] && bbox[2] >= area[0] && bbox[1] <= area[3] && bbox[3] >= area[1];
}

export async function digitrafficVessels(
  bbox: Bbox,
  signal?: AbortSignal
): Promise<LiveTrafficResult> {
  if (!overlaps(bbox, COVERAGE)) {
    return {
      features: [],
      status: "partial",
      notice:
        "Zdroj Digitraffic pokrývá jen finské vody. Ve zbytku světa se lodě načtou po nastavení klíče AISstream.",
      source: DIGITRAFFIC,
      fetchedAt: new Date().toISOString()
    };
  }

  const [locations, vessels] = await Promise.all([
    fetchJson<{ features?: LocationFeature[] }>(
      "https://meri.digitraffic.fi/api/ais/v1/locations",
      {
        providerId: "digitraffic",
        headers: { "Digitraffic-User": USER_HEADER, "Accept-Encoding": "gzip" },
        signal,
        ttlMs: LOCATIONS_TTL_MS,
        timeoutMs: 12_000,
        maxResponseBytes: 8 * 1024 * 1024
      }
    ),
    fetchJson<VesselMeta[]>("https://meri.digitraffic.fi/api/ais/v1/vessels", {
      providerId: "digitraffic",
      headers: { "Digitraffic-User": USER_HEADER, "Accept-Encoding": "gzip" },
      signal,
      ttlMs: VESSELS_TTL_MS,
      timeoutMs: 20_000,
      maxResponseBytes: 8 * 1024 * 1024
    }).catch(() => [] as VesselMeta[])
  ]);

  const meta = new Map<number, VesselMeta>();
  for (const vessel of Array.isArray(vessels) ? vessels : [])
    if (typeof vessel.mmsi === "number") meta.set(vessel.mmsi, vessel);

  const now = Date.now();
  const features = (locations.features ?? []).flatMap((row) => {
    const coords = row.geometry?.coordinates;
    if (!coords || coords.length < 2 || !coords.every(Number.isFinite)) return [];
    const [lng, lat] = coords as [number, number];
    if (!withinLiveBbox(bbox, lng, lat)) return [];
    const mmsi = row.mmsi ?? row.properties?.mmsi;
    if (typeof mmsi !== "number") return [];
    const info = meta.get(mmsi);
    const timestamp = row.properties?.timestampExternal;
    return [
      shipFeature(
        {
          mmsi,
          name: info?.name?.trim() || `MMSI ${mmsi}`,
          lng,
          lat,
          speedKt: row.properties?.sog,
          courseDeg: row.properties?.cog,
          headingDeg: row.properties?.heading ?? row.properties?.cog,
          navStatus: row.properties?.navStat,
          shipType: info?.shipType,
          imo: info?.imo,
          callSign: info?.callSign,
          destination: info?.destination,
          fixAgeSeconds:
            typeof timestamp === "number" && timestamp > 0
              ? Math.max(0, Math.round((now - timestamp) / 1000))
              : undefined
        },
        DIGITRAFFIC
      )
    ];
  });

  return {
    features: features.slice(0, MAX_VESSELS),
    status: "partial",
    notice:
      features.length > MAX_VESSELS
        ? "Digitraffic: nejvýše 600 lodí ve finských vodách. Přibliž mapu."
        : "Digitraffic pokrývá jen finské vody; úplnost závisí na AIS přijímačích.",
    source: DIGITRAFFIC,
    fetchedAt: new Date().toISOString()
  };
}
