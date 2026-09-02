import type { GeoFeature } from "@mapos/layer-sdk";
import { config } from "../../config.js";
import { UpstreamError, fetchJson, fetchText } from "../../utils/upstream.js";
import { bboxCenter, bboxSpanKm, point, withinBbox, type DataSource } from "./types.js";

/**
 * Layers that need a free API key.
 *
 * None of these are hidden behind money — every one is a registration form and an email — but
 * they cannot ship keyless, so the layer is only offered when the deployment has the key (see
 * `requiresCapability` on the manifests). The sign-up links live in `docs/data-sources.md`.
 *
 * These adapters are written against the providers' documented response shapes but, unlike the
 * keyless ones, could not be run against the live services here. They parse defensively: a
 * field that isn't where the docs say it is yields a skipped record, never a crash.
 */

function requireKey(name: keyof typeof KEY_LABELS): string {
  const key = config.layerKeys[name];
  if (!key) throw new UpstreamError(KEY_LABELS[name], `chybí klíč ${KEY_ENV[name]}`);
  return key;
}

const KEY_LABELS = {
  ocm: "OpenChargeMap",
  mapillary: "Mapillary",
  firms: "NASA FIRMS",
  openaq: "OpenAQ",
  ebird: "eBird"
} as const;

const KEY_ENV = {
  ocm: "OPENCHARGEMAP_API_KEY",
  mapillary: "MAPILLARY_ACCESS_TOKEN",
  firms: "NASA_FIRMS_MAP_KEY",
  openaq: "OPENAQ_API_KEY",
  ebird: "EBIRD_API_TOKEN"
} as const;

/** Charging stations, with connector types and power — far richer than the OSM tag. */
export const chargingStations: DataSource = {
  id: "charging-stations",
  async load(bbox) {
    const key = requireKey("ocm");
    const [west, south, east, north] = bbox;
    const rows = await fetchJson<
      Array<{
        ID: number;
        AddressInfo?: {
          Title?: string;
          AddressLine1?: string;
          Town?: string;
          Latitude?: number;
          Longitude?: number;
        };
        OperatorInfo?: { Title?: string };
        StatusType?: { IsOperational?: boolean };
        Connections?: Array<{ PowerKW?: number; ConnectionType?: { Title?: string } }>;
      }>
    >(
      `https://api.openchargemap.io/v3/poi?output=json&maxresults=300&compact=true&verbose=false` +
        `&boundingbox=(${north},${west}),(${south},${east})&key=${encodeURIComponent(key)}`,
      { providerId: "openchargemap", ttlMs: 30 * 60_000 }
    );

    return rows.flatMap((row): GeoFeature[] => {
      const lat = row.AddressInfo?.Latitude;
      const lng = row.AddressInfo?.Longitude;
      if (lat === undefined || lng === undefined) return [];
      const power = Math.max(0, ...(row.Connections ?? []).map((c) => c.PowerKW ?? 0));
      return [
        point(
          `ocm:${row.ID}`,
          row.AddressInfo?.Title ?? "Nabíjecí stanice",
          lng,
          lat,
          "charging-stations",
          {
            category: "charging",
            operator: row.OperatorInfo?.Title,
            address: [row.AddressInfo?.AddressLine1, row.AddressInfo?.Town]
              .filter(Boolean)
              .join(", "),
            powerKw: power || undefined,
            connectors: (row.Connections ?? [])
              .map((c) => c.ConnectionType?.Title)
              .filter(Boolean)
              .join(", "),
            operational: row.StatusType?.IsOperational
          }
        )
      ];
    });
  }
};

/** Street-level imagery. The real payoff is the info panel: a photo of the place you tapped. */
export const mapillary: DataSource = {
  id: "mapillary",
  tooLarge: (bbox) =>
    bboxSpanKm(bbox) > 30 ? "Přibliž mapu — snímky se načítají pro menší výřez." : null,
  async load(bbox) {
    const token = requireKey("mapillary");
    const data = await fetchJson<{
      data?: Array<{
        id: string;
        thumb_256_url?: string;
        captured_at?: number;
        compass_angle?: number;
        computed_geometry?: { coordinates?: [number, number] };
        geometry?: { coordinates?: [number, number] };
      }>;
    }>(
      `https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}` +
        `&bbox=${bbox.join(",")}&limit=200` +
        `&fields=id,thumb_256_url,captured_at,compass_angle,computed_geometry,geometry`,
      { providerId: "mapillary", ttlMs: 30 * 60_000 }
    );

    return (data.data ?? []).flatMap((img): GeoFeature[] => {
      // `computed_geometry` is the SfM-corrected position and is the better one when present.
      const coords = img.computed_geometry?.coordinates ?? img.geometry?.coordinates;
      if (!coords) return [];
      return [
        point(`mapillary:${img.id}`, "Snímek ulice", coords[0], coords[1], "mapillary", {
          category: "street-photo",
          photo: img.thumb_256_url,
          bearing: img.compass_angle,
          capturedAt: img.captured_at ? new Date(img.captured_at).toISOString() : undefined,
          website: `https://www.mapillary.com/app/?pKey=${img.id}`
        })
      ];
    });
  }
};

/** Active fire detections from VIIRS. The API answers in CSV, not JSON. */
export const activeFires: DataSource = {
  id: "active-fires",
  async load(bbox, query) {
    const key = requireKey("firms");
    const days = Math.min(Math.max(Number(query.days) || 1, 1), 7);
    const [west, south, east, north] = bbox;
    const url =
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}` +
      `/VIIRS_SNPP_NRT/${west},${south},${east},${north}/${days}`;

    const text = await fetchText(url, {
      providerId: "nasa-firms",
      ttlMs: 5 * 60_000,
      timeoutMs: 15_000,
      maxResponseBytes: 4 * 1024 * 1024,
      acceptedContentTypes: ["text/csv", "text/plain", "application/octet-stream"]
    });
    // An invalid key comes back as a plain-text message with a 200, not an error status.
    if (!text.includes("latitude")) throw new UpstreamError("nasa-firms", "neplatný MAP_KEY");

    const [header, ...rows] = text.trim().split(/\r?\n/);
    const columns = (header ?? "").split(",");
    const at = (name: string) => columns.indexOf(name);
    const latAt = at("latitude");
    const lngAt = at("longitude");
    const brightAt = at("bright_ti4");
    const dateAt = at("acq_date");
    const timeAt = at("acq_time");
    const confAt = at("confidence");

    return rows.flatMap((row, i): GeoFeature[] => {
      const cells = row.split(",");
      const lat = Number(cells[latAt]);
      const lng = Number(cells[lngAt]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      return [
        point(`firms:${cells[dateAt]}:${i}`, "Detekovaný požár", lng, lat, "active-fires", {
          category: "fire",
          brightness: Number(cells[brightAt]) || undefined,
          confidence: cells[confAt],
          detectedAt: `${cells[dateAt]} ${cells[timeAt]}`
        })
      ];
    });
  }
};

/** Reference-grade air quality stations, complementing Sensor.Community's citizen sensors. */
export const openAq: DataSource = {
  id: "openaq",
  async load(bbox) {
    const key = requireKey("openaq");
    const data = await fetchJson<{
      results?: Array<{
        id: number;
        name?: string;
        locality?: string;
        coordinates?: { latitude?: number; longitude?: number };
        sensors?: Array<{ parameter?: { name?: string; units?: string } }>;
        datetimeLast?: { utc?: string };
      }>;
    }>(`https://api.openaq.org/v3/locations?bbox=${bbox.join(",")}&limit=200`, {
      providerId: "openaq",
      ttlMs: 30 * 60_000,
      headers: { "X-API-Key": key }
    });

    return (data.results ?? []).flatMap((loc): GeoFeature[] => {
      const lat = loc.coordinates?.latitude;
      const lng = loc.coordinates?.longitude;
      if (lat === undefined || lng === undefined) return [];
      return [
        point(`openaq:${loc.id}`, loc.name ?? "Měřicí stanice", lng, lat, "openaq", {
          category: "air-station",
          locality: loc.locality,
          parameters: (loc.sensors ?? [])
            .map((s) => s.parameter?.name)
            .filter(Boolean)
            .join(", "),
          measuredAt: loc.datetimeLast?.utc
        })
      ];
    });
  }
};

/** Recent bird sightings. eBird's geo endpoint is centre-and-radius, capped at 50 km. */
export const birdSightings: DataSource = {
  id: "ebird",
  tooLarge: (bbox) =>
    bboxSpanKm(bbox) > 100 ? "Přibliž mapu — pozorování se hledají v okruhu do 50 km." : null,
  async load(bbox, query) {
    const token = requireKey("ebird");
    const { lng, lat } = bboxCenter(bbox);
    const dist = Math.min(50, Math.max(2, Math.round(bboxSpanKm(bbox) / 2)));
    const back = Math.min(30, Math.max(1, Number(query.days) || 7));

    const rows = await fetchJson<
      Array<{
        speciesCode?: string;
        comName?: string;
        sciName?: string;
        locName?: string;
        obsDt?: string;
        howMany?: number;
        lat?: number;
        lng?: number;
        subId?: string;
      }>
    >(
      `https://api.ebird.org/v2/data/obs/geo/recent?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}` +
        `&dist=${dist}&back=${back}&maxResults=200`,
      { providerId: "ebird", ttlMs: 20 * 60_000, headers: { "X-eBirdApiToken": token } }
    );

    return rows.flatMap((obs, i): GeoFeature[] => {
      if (obs.lat === undefined || obs.lng === undefined) return [];
      if (!withinBbox(bbox, obs.lng, obs.lat)) return [];
      return [
        point(
          `ebird:${obs.subId ?? i}:${obs.speciesCode ?? i}`,
          obs.comName ?? "Pozorování ptáka",
          obs.lng,
          obs.lat,
          "ebird",
          {
            category: "bird",
            scientificName: obs.sciName,
            count: obs.howMany,
            locationName: obs.locName,
            observedOn: obs.obsDt
          }
        )
      ];
    });
  }
};

export const keyedSources: DataSource[] = [
  chargingStations,
  mapillary,
  activeFires,
  openAq,
  birdSightings
];

export const __testing = { KEY_ENV };
