import { isMapResultArtifact, type Bbox, type GeoFeature } from "@mapos/layer-sdk";
import { fetchJson } from "../../utils/upstream.js";
import { point, withinBbox, type DataSource } from "./types.js";

type RawFeature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
};
type RawCollection = { features?: RawFeature[] };
const kinds = new Set(["EQ", "TC", "FL", "VO", "DR", "WF"]);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 500) : "");
const options = {
  providerId: "gdacs",
  ttlMs: 15 * 60000,
  minIntervalMs: 1000,
  timeoutMs: 12000,
  maxResponseBytes: 4 * 1024 * 1024,
  retries: 0
};
export const gdacsSource = {
  id: "gdacs",
  label: "GDACS · European Commission / UN",
  url: "https://www.gdacs.org/About/termofuse.aspx"
};

/** Latest episode per stable event; severity values keep their original units. */
export function gdacsEvents(raw: RawCollection, bbox: Bbox): GeoFeature[] {
  if (!Array.isArray(raw.features) || raw.features.length > 1000)
    throw new Error("Invalid GDACS response");
  const latest = new Map<string, GeoFeature>();
  for (const feature of raw.features) {
    const p = feature.properties,
      coordinates = feature.geometry?.coordinates;
    if (
      !p ||
      feature.geometry?.type !== "Point" ||
      !Array.isArray(coordinates) ||
      coordinates.length !== 2 ||
      !coordinates.every(Number.isFinite)
    )
      continue;
    const [lng, lat] = coordinates as [number, number];
    if (
      Math.abs(lng) > 180 ||
      Math.abs(lat) > 90 ||
      !kinds.has(String(p.eventtype)) ||
      !Number.isSafeInteger(p.eventid) ||
      !Number.isSafeInteger(p.episodeid)
    )
      continue;
    const eventId = `gdacs:${p.eventtype}:${p.eventid}`;
    if (Number(latest.get(eventId)?.properties.episodeId ?? -1) >= Number(p.episodeid)) continue;
    const severity = record(p.severitydata) ? p.severitydata : {};
    latest.set(
      eventId,
      point(eventId, text(p.name) || String(p.eventtype), lng, lat, "disaster-impacts", {
        eventType: p.eventtype,
        eventId: p.eventid,
        episodeId: p.episodeid,
        alert: ["Green", "Orange", "Red"].includes(String(p.alertlevel)) ? p.alertlevel : "Unknown",
        start: text(p.fromdate),
        end: text(p.todate),
        updatedAt: text(p.datemodified),
        severity:
          typeof severity.severity === "number" && Number.isFinite(severity.severity)
            ? severity.severity
            : null,
        unit: text(severity.severityunit),
        severityText: text(severity.severitytext),
        source: gdacsSource.label,
        sourceId: gdacsSource.id,
        originalSource: text(p.source),
        website: `https://www.gdacs.org/report.aspx?eventtype=${p.eventtype}&eventid=${p.eventid}&episodeid=${p.episodeid}`,
        description:
          "Automatický model dopadu GDACS; není místním varováním ani potvrzením bezpečného přístupu. Ověřte situaci u místních úřadů.",
        footprints: []
      })
    );
  }
  return [...latest.values()].filter(
    (event) =>
      typeof event.geometry.coordinates[0] === "number" &&
      typeof event.geometry.coordinates[1] === "number" &&
      withinBbox(bbox, event.geometry.coordinates[0], event.geometry.coordinates[1])
  );
}

/** Validate polygon topology and size through the same bounded contract as AI map results. */
export function gdacsFootprints(raw: RawCollection, event: GeoFeature) {
  const footprints: { geometry: unknown; label: string; time: string; category: string }[] = [];
  for (const feature of (raw.features ?? []).slice(0, 30)) {
    const p = feature.properties;
    if (
      !p ||
      p.eventtype !== event.properties.eventType ||
      p.eventid !== event.properties.eventId ||
      p.episodeid !== event.properties.episodeId ||
      !["Polygon", "MultiPolygon"].includes(feature.geometry?.type ?? "")
    )
      continue;
    const label = text(p.polygonlabel) || text(p.Class) || "Modelovaná oblast";
    const valid = isMapResultArtifact({
      schema: "mapos.map-result",
      schemaVersion: "1.0.0",
      id: "validation",
      conversationId: "validation",
      runId: "validation",
      revision: 0,
      title: label,
      sources: [gdacsSource],
      style: { palette: "blue", opacity: 0.4 },
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "shape",
            geometry: feature.geometry,
            properties: { title: label, sourceId: "gdacs" }
          }
        ]
      }
    });
    if (valid)
      footprints.push({
        geometry: feature.geometry,
        label,
        time: text(p.polygondate),
        category: text(p.Class)
      });
  }
  return footprints;
}

export const gdacs: DataSource = {
  id: "disaster-impacts",
  async load(bbox, _query, signal) {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const params = new URLSearchParams({
      eventlist: "EQ;TC;FL;VO;DR;WF",
      fromDate: start,
      toDate: end,
      pageSize: "100",
      pageNumber: "1"
    });
    const raw = await fetchJson<RawCollection>(
      `https://www.gdacs.org/gdacsapi/api/Events/geteventlist/SEARCH?${params}`,
      { ...options, signal }
    );
    const features = gdacsEvents(raw, bbox);
    // Only a small local selection downloads detailed footprints. Country/global views stay cheap.
    if ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) < 100) {
      for (const event of features.slice(0, 3)) {
        signal?.throwIfAborted();
        try {
          const p = event.properties;
          const geometry = await fetchJson<RawCollection>(
            `https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=${p.eventType}&eventid=${p.eventId}&episodeid=${p.episodeId}`,
            { ...options, signal }
          );
          p.footprints = gdacsFootprints(geometry, event);
        } catch {
          signal?.throwIfAborted();
        }
      }
    }
    return {
      features,
      status: "partial",
      notice:
        "GDACS: posledních 7 dní, nejvýše 100 událostí; při přiblížení modelované oblasti nejvýše tří událostí. Nejde o úplný přehled ani místní varování."
    };
  }
};
