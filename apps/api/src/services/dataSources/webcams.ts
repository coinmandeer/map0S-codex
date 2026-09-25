import { isIP } from "node:net";
import type { Bbox, GeoFeature } from "@mapos/layer-sdk";
import { readFile } from "node:fs/promises";
import { bboxSpanKm, point, withinBbox, type DataSource, type DataSourceResult } from "./types.js";
interface CameraElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
/** Outbound operator links only. The server never fetches webcam URLs. */
export function webcamLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      isIP(host) ||
      !host.includes(".") ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) ||
      u.port
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}
export function mapWebcams(
  elements: CameraElement[],
  bbox: Bbox,
  partial = false
): DataSourceResult {
  const features: GeoFeature[] = [];
  for (const el of elements.slice(0, 300)) {
    const tags = el.tags ?? {};
    // Do not expand this into a map of CCTV without published webcam links.
    if (
      /^(private|no)$/.test(tags.access ?? "") ||
      tags.indoor === "yes" ||
      tags.surveillance === "indoor"
    )
      continue;
    const website = webcamLink(tags["contact:webcam"]);
    const lng = el.lon ?? el.center?.lon,
      lat = el.lat ?? el.center?.lat;
    if (
      !website ||
      typeof lng !== "number" ||
      typeof lat !== "number" ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      !withinBbox(bbox, lng, lat) ||
      !["node", "way", "relation"].includes(el.type) ||
      !Number.isSafeInteger(el.id)
    )
      continue;
    features.push(
      point(`osm-webcam:${el.type}/${el.id}`, tags.name ?? "Webkamera", lng, lat, "webcams", {
        category: "webcam",
        website,
        operator: tags.operator,
        sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
        cameraAccess: "Odkaz na veřejnou stránku uvedenou v OSM; dostupnost přenosu neověřena",
        mediaRights: "ODbL platí pro katalog, nikoli automaticky pro snímky provozovatele",
        attribution: "© OpenStreetMap contributors · ODbL",
        locationMeaning:
          el.type === "node"
            ? "Bod uvedený v OSM"
            : "Střed mapovaného objektu; poloha kamery může být přibližná"
      })
    );
  }
  const limited = partial || elements.length > 300;
  return {
    features,
    status: limited ? "partial" : "complete",
    notice: limited
      ? "Částečný katalog kamer; přibližte mapu. Některé odkazy nemusí být aktuální."
      : undefined
  };
}
export interface WebcamCatalogue {
  revision: string;
  builtAt: string;
  features: GeoFeature[];
}
let catalogue: Promise<WebcamCatalogue> | undefined;
async function loadCatalogue(): Promise<WebcamCatalogue> {
  catalogue ??= Promise.all(
    [
      ["webcams-catalog.json", "osm"],
      ["odh-webcams-catalog.json", "odh"],
      ["digitraffic-webcams-catalog.json", "digitraffic"]
    ].map(async ([file, provider]) => {
      const value = JSON.parse(
        await readFile(new URL(`../../../data/${file}`, import.meta.url), "utf8")
      ) as WebcamCatalogue;
      if (!value.revision || !Array.isArray(value.features) || value.features.length > 20000)
        throw new Error("Invalid webcam catalogue");
      return {
        ...value,
        features: value.features.map((feature) => ({
          ...feature,
          properties: { ...feature.properties, cameraProvider: provider }
        }))
      };
    })
  )
    .then((parts) => ({
      revision: parts.map((p) => p.revision).join("/"),
      builtAt: parts[0]!.builtAt,
      features: parts.flatMap((p) => p.features)
    }))
    .catch((error) => {
      catalogue = undefined;
      throw error;
    });
  return catalogue;
}
export function createWebcamsSource(
  loader: () => Promise<WebcamCatalogue> = loadCatalogue
): DataSource {
  return {
    id: "webcams",
    tooLarge: (bbox) =>
      bboxSpanKm(bbox) > 150 ? "Přibližte mapu — webkamery zobrazujeme ve výřezu do150km." : null,
    async load(bbox, filters, signal) {
      const [w, s, e, n] = bbox;
      if (
        !bbox.every(Number.isFinite) ||
        w < -180 ||
        e > 180 ||
        s < -85.1 ||
        n > 85.1 ||
        w >= e ||
        s >= n ||
        bboxSpanKm(bbox) > 150
      )
        throw new Error("Unsupported webcam bounds");
      signal?.throwIfAborted();
      const data = await loader();
      signal?.throwIfAborted();
      const providers = (filters.provider ?? "").split(",").filter(Boolean);
      if (providers.some((id) => !["osm", "odh", "digitraffic"].includes(id)))
        throw new Error("Unknown camera source");
      const matches = data.features.filter(
        (feature) =>
          (!providers.length || providers.includes(String(feature.properties.cameraProvider))) &&
          feature.geometry.type === "Point" &&
          withinBbox(bbox, feature.geometry.coordinates[0], feature.geometry.coordinates[1])
      );
      return {
        features: matches.slice(0, 300),
        status: matches.length > 300 ? "partial" : "complete",
        notice:
          matches.length > 300
            ? "Zobrazeno prvních300kamer z místního katalogu; přibližte mapu."
            : undefined
      };
    }
  };
}
export const webcams = createWebcamsSource();
