import type { Bbox, GeoFeature } from "@mapos/layer-sdk";
import { fetchJson } from "../../utils/upstream.js";
import { withinBbox } from "../dataSources/types.js";
import { ADSB_LOL, bboxCornerRadiusM, distanceM, type LiveTrafficResult } from "./types.js";

/**
 * Live aircraft from ADSB.lol.
 *
 * The API is ADS-B Exchange v2 compatible and answers a point/radius question, not a bbox one.
 * The radius is derived from the viewport corners and capped at the provider's 250 NM maximum,
 * so a continental view is served as "the nearest 250 NM around the centre" and says so.
 *
 * ADSB.lol publishes the data under ODbL 1.0: the source and the licence travel with every
 * feature and the layer manifest repeats them. There is no completeness guarantee — a missing
 * aircraft means no receiver heard it, not that it is not there.
 */

const MAX_RADIUS_NM = 250;
const KM_PER_NM = 1.852;
/** A single viewport answer is capped so one busy sky cannot hand the browser a megabyte and
 *  40 000 circles. The nearest aircraft are the ones worth drawing. */
const MAX_AIRCRAFT = 400;
const CACHE_TTL_MS = 8_000;

interface RawAircraft {
  hex?: string;
  type?: string;
  flight?: string;
  r?: string;
  t?: string;
  alt_baro?: number | string;
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  category?: string;
  emergency?: string;
  lat?: number;
  lon?: number;
  seen_pos?: number;
  seen?: number;
  dst?: number;
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text !== "none" ? text : null;
}

function firstNumber(...values: Array<number | undefined>): number | undefined {
  for (const value of values) if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

/** ADSB.lol is queried by a rounded centre so panning a few pixels does not defeat the upstream
 *  cache; the client's own bbox filter still only draws what is on screen. */
function queryCentre(bbox: Bbox): { lng: number; lat: number } {
  const [west, south, east, north] = bbox;
  return {
    lng: Math.round(((west + east) / 2) * 10) / 10,
    lat: Math.round(((south + north) / 2) * 10) / 10
  };
}

export async function aircraftInView(bbox: Bbox, signal?: AbortSignal): Promise<LiveTrafficResult> {
  const { lng, lat } = queryCentre(bbox);
  const wantedNm = Math.ceil(bboxCornerRadiusM(bbox) / 1000 / KM_PER_NM);
  const radiusNm = Math.max(5, Math.min(MAX_RADIUS_NM, wantedNm));
  const capped = wantedNm > MAX_RADIUS_NM;

  const data = await fetchJson<{ ac?: RawAircraft[]; now?: number }>(
    `https://api.adsb.lol/v2/point/${lat.toFixed(2)}/${lng.toFixed(2)}/${radiusNm}`,
    {
      providerId: "adsblol",
      signal,
      ttlMs: CACHE_TTL_MS,
      timeoutMs: 10_000,
      maxResponseBytes: 4 * 1024 * 1024
    }
  );

  const observedResponseAt =
    typeof data.now === "number" && Number.isFinite(data.now)
      ? Math.min(Date.now(), data.now)
      : Date.now();
  const seen = new Set<string>();
  const rows = (data.ac ?? []).flatMap((row): Array<{ feature: GeoFeature; distance: number }> => {
    const hex = clean(row.hex);
    const rowLng = firstNumber(row.lon);
    const rowLat = firstNumber(row.lat);
    if (!hex || seen.has(hex) || rowLng === undefined || rowLat === undefined) return [];
    seen.add(hex);
    const callsign = clean(row.flight);
    const registration = clean(row.r);
    const typeCode = clean(row.t);
    const altitudeFt = typeof row.alt_baro === "number" ? row.alt_baro : undefined;
    const onGround =
      row.alt_baro === "ground" || (altitudeFt === undefined && row.gs === undefined);
    const name = callsign ?? registration ?? hex.toUpperCase();
    return [
      {
        distance: distanceM(lng, lat, rowLng, rowLat),
        feature: {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [rowLng, rowLat] },
          properties: {
            id: `adsblol:${hex}`,
            name,
            layerId: "live-aircraft",
            category: onGround ? "aircraft-ground" : "aircraft",
            callsign: callsign ?? undefined,
            registration: registration ?? undefined,
            aircraftType: typeCode ?? undefined,
            altitudeFt,
            speedKt: firstNumber(row.gs),
            headingDeg: firstNumber(row.track),
            verticalRateFpm: firstNumber(row.baro_rate, row.geom_rate),
            onGround: onGround ? "Ano" : "Ne",
            seenPosSeconds:
              Math.max(0, (Date.now() - observedResponseAt) / 1000) +
              Math.max(0, firstNumber(row.seen_pos, row.seen) ?? 0),
            observedAt: new Date(
              observedResponseAt - Math.max(0, firstNumber(row.seen_pos, row.seen) ?? 0) * 1000
            ).toISOString(),
            squawk: clean(row.squawk) ?? undefined,
            emergency: clean(row.emergency) ?? undefined,
            sourceLabel: ADSB_LOL.label,
            externalUrl: `https://adsb.lol/?icao=${encodeURIComponent(hex)}`
          }
        }
      }
    ];
  });

  const inView = rows
    .filter((row) => withinBbox(bbox, ...(row.feature.geometry.coordinates as [number, number])))
    .sort((a, b) => a.distance - b.distance);
  const features = inView.slice(0, MAX_AIRCRAFT).map((row) => row.feature);

  const notices: string[] = [];
  if (capped)
    notices.push(
      `Přibliž mapu: zobrazena jsou letadla do ${MAX_RADIUS_NM} nm (${Math.round(MAX_RADIUS_NM * KM_PER_NM)} km) od středu.`
    );
  if (inView.length > MAX_AIRCRAFT)
    notices.push(`Zobrazeno nejbližších ${MAX_AIRCRAFT} z ${inView.length} letadel v okně.`);
  if (!features.length)
    notices.push("V tomto okně teď žádný přijímač letadlo neslyší — mapa nemusí být prázdná.");

  return {
    features,
    status: notices.length ? "partial" : "complete",
    ...(notices.length ? { notice: notices.join(" ") } : {}),
    source: ADSB_LOL,
    fetchedAt: new Date().toISOString()
  };
}
