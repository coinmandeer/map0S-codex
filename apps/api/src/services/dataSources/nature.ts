import type { Bbox, GeoFeature } from "@mapos/layer-sdk";
import { fetchJson } from "../../utils/upstream.js";
import { bboxSpanKm, point, withinBbox, type DataSource } from "./types.js";

/** USGS publishes every earthquake it detects, worldwide, with no key and a GeoJSON response
 *  that is already in our shape. */
export const earthquakes: DataSource = {
  id: "earthquakes",
  async load(bbox, query) {
    const [west, south, east, north] = bbox;
    const days = Number(query.days) > 0 ? Math.min(Number(query.days), 365) : 30;
    const minMagnitude = Number(query.minMagnitude) || 1;
    const start = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    const data = await fetchJson<{
      features?: Array<{
        id: string;
        properties?: { mag?: number; place?: string; time?: number; url?: string };
        geometry?: { coordinates?: [number, number, number] };
      }>;
    }>(
      `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
        `&minlatitude=${south}&maxlatitude=${north}&minlongitude=${west}&maxlongitude=${east}` +
        `&starttime=${start}&minmagnitude=${minMagnitude}&limit=500&orderby=time`,
      { source: "USGS", ttlMs: 10 * 60_000 }
    );

    return (data.features ?? []).flatMap((f): GeoFeature[] => {
      const coords = f.geometry?.coordinates;
      if (!coords) return [];
      const [lng, lat, depthKm] = coords;
      const magnitude = f.properties?.mag ?? 0;
      return [
        point(
          `usgs:${f.id}`,
          `M${magnitude.toFixed(1)} — ${f.properties?.place ?? "zemětřesení"}`,
          lng,
          lat,
          "earthquakes",
          {
            category: "earthquake",
            magnitude,
            depthKm,
            occurredAt: f.properties?.time ? new Date(f.properties.time).toISOString() : undefined,
            website: f.properties?.url
          }
        )
      ];
    });
  }
};

/** Species observations from iNaturalist. `photos=true` keeps it to records with an image,
 *  which is what makes the layer worth looking at rather than a field of identical dots. */
export const inaturalist: DataSource = {
  id: "inaturalist",
  tooLarge: (bbox) =>
    bboxSpanKm(bbox) > 200 ? "Přibliž mapu — pozorování se načítají pro menší výřez." : null,
  async load(bbox, query) {
    const [west, south, east, north] = bbox;
    const params = new URLSearchParams({
      nelat: String(north),
      nelng: String(east),
      swlat: String(south),
      swlng: String(west),
      per_page: "200",
      order_by: "observed_on",
      photos: "true"
    });
    if (query.taxon) params.set("iconic_taxa", query.taxon);

    const data = await fetchJson<{
      results?: Array<{
        id: number;
        geojson?: { coordinates?: [number, number] };
        species_guess?: string;
        observed_on?: string;
        uri?: string;
        taxon?: { name?: string; preferred_common_name?: string; iconic_taxon_name?: string };
        photos?: Array<{ url?: string }>;
      }>;
    }>(`https://api.inaturalist.org/v1/observations?${params}`, {
      source: "iNaturalist",
      ttlMs: 15 * 60_000
    });

    return (data.results ?? []).flatMap((o): GeoFeature[] => {
      const coords = o.geojson?.coordinates;
      if (!coords) return [];
      const [lng, lat] = coords;
      const name =
        o.taxon?.preferred_common_name ?? o.taxon?.name ?? o.species_guess ?? "Pozorování";
      return [
        point(`inat:${o.id}`, name, lng, lat, "inaturalist", {
          category: "observation",
          scientificName: o.taxon?.name,
          taxonGroup: o.taxon?.iconic_taxon_name,
          observedOn: o.observed_on,
          // The API returns square thumbnails; the larger variant is a simple name swap.
          photo: o.photos?.[0]?.url?.replace("square", "medium"),
          website: o.uri
        })
      ];
    });
  }
};

/** GBIF aggregates museum and research collections — the historical counterpart to
 *  iNaturalist's live observations. */
export const gbif: DataSource = {
  id: "gbif",
  tooLarge: (bbox) =>
    bboxSpanKm(bbox) > 200 ? "Přibliž mapu — nálezy se načítají pro menší výřez." : null,
  async load(bbox) {
    const [west, south, east, north] = bbox;
    const data = await fetchJson<{
      results?: Array<{
        key: number;
        decimalLatitude?: number;
        decimalLongitude?: number;
        species?: string;
        scientificName?: string;
        eventDate?: string;
        year?: number;
        datasetName?: string;
      }>;
    }>(
      `https://api.gbif.org/v1/occurrence/search?decimalLatitude=${south},${north}` +
        `&decimalLongitude=${west},${east}&hasCoordinate=true&limit=300`,
      { source: "GBIF", ttlMs: 30 * 60_000 }
    );

    return (data.results ?? []).flatMap((r): GeoFeature[] => {
      if (r.decimalLatitude === undefined || r.decimalLongitude === undefined) return [];
      return [
        point(
          `gbif:${r.key}`,
          r.species ?? r.scientificName ?? "Nález",
          r.decimalLongitude,
          r.decimalLatitude,
          "gbif",
          {
            category: "occurrence",
            scientificName: r.scientificName,
            observedOn: r.eventDate ?? (r.year ? String(r.year) : undefined),
            dataset: r.datasetName,
            website: `https://www.gbif.org/occurrence/${r.key}`
          }
        )
      ];
    });
  }
};

/** Air quality from Sensor.Community's citizen-run sensor network. The API is radius-based, so
 *  the viewport is approximated by a circle around its centre. */
export const airQuality: DataSource = {
  id: "air-quality",
  tooLarge: (bbox) =>
    bboxSpanKm(bbox) > 120 ? "Přibliž mapu — senzory se načítají pro menší výřez." : null,
  async load(bbox) {
    const [west, south, east, north] = bbox;
    const lat = (south + north) / 2;
    const lng = (west + east) / 2;
    const radiusKm = Math.max(2, Math.min(60, bboxSpanKm(bbox) / 2));

    const data = await fetchJson<
      Array<{
        id: number;
        timestamp?: string;
        location?: { latitude?: string; longitude?: string; country?: string };
        sensor?: { id?: number; sensor_type?: { name?: string } };
        sensordatavalues?: Array<{ value_type?: string; value?: string }>;
      }>
    >(
      `https://data.sensor.community/airrohr/v1/filter/area=${lat.toFixed(4)},${lng.toFixed(4)},${radiusKm.toFixed(1)}`,
      { source: "Sensor.Community", ttlMs: 5 * 60_000 }
    );

    // One sensor reports repeatedly within the window; only its newest reading is interesting.
    const newest = new Map<number, (typeof data)[number]>();
    for (const row of data) {
      const sensorId = row.sensor?.id;
      if (sensorId === undefined) continue;
      const previous = newest.get(sensorId);
      if (!previous || (row.timestamp ?? "") > (previous.timestamp ?? "")) {
        newest.set(sensorId, row);
      }
    }

    return [...newest.values()].flatMap((row): GeoFeature[] => {
      const lat2 = Number(row.location?.latitude);
      const lng2 = Number(row.location?.longitude);
      if (!Number.isFinite(lat2) || !Number.isFinite(lng2)) return [];
      if (!withinBbox(bbox, lng2, lat2)) return [];

      const values = Object.fromEntries(
        (row.sensordatavalues ?? [])
          .filter((v) => v.value_type && v.value)
          .map((v) => [v.value_type!, Number(v.value)])
      );
      // P1/P2 are PM10 and PM2.5; the rest of the network reports temperature and humidity.
      const pm25 = values.P2;
      const pm10 = values.P1;
      const label =
        pm25 !== undefined
          ? `PM2.5 ${pm25.toFixed(1)} µg/m³`
          : pm10 !== undefined
            ? `PM10 ${pm10.toFixed(1)} µg/m³`
            : values.temperature !== undefined
              ? `${values.temperature.toFixed(1)} °C`
              : "Senzor";

      return [
        point(`sensor:${row.sensor?.id}`, label, lng2, lat2, "air-quality", {
          category: "air-sensor",
          pm25,
          pm10,
          temperature: values.temperature,
          humidity: values.humidity,
          measuredAt: row.timestamp,
          sensorType: row.sensor?.sensor_type?.name,
          website: `https://maps.sensor.community/`
        })
      ];
    });
  }
};

export const natureSources: DataSource[] = [earthquakes, inaturalist, gbif, airQuality];

export const __testing = { bboxSpanKm };
export type { Bbox };
