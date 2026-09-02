import {
  assertPlanDocumentV2,
  type PlanDocumentV2,
  type Position,
  type RouteAlternativeV2,
  type RouteSegmentV2
} from "@mapos/layer-sdk";

export interface PlanGeoJsonFeature {
  type: "Feature";
  id: string;
  geometry:
    { type: "Point"; coordinates: Position } | { type: "LineString"; coordinates: Position[] };
  properties: Record<string, string | number | boolean | null>;
}

export interface PlanGeoJsonCollection {
  type: "FeatureCollection";
  features: PlanGeoJsonFeature[];
}

function selectedAlternative(segment: RouteSegmentV2): RouteAlternativeV2 | null {
  if (segment.status !== "ready" && segment.status !== "partial") return null;
  return (
    segment.alternatives.find((alternative) => alternative.id === segment.selectedAlternativeId) ??
    null
  );
}

/** Stops are emitted first in itinerary order, followed by selected segment lines in route order. */
export function planToGeoJson(document: PlanDocumentV2): PlanGeoJsonCollection {
  assertPlanDocumentV2(document);
  const stopFeatures: PlanGeoJsonFeature[] = document.stops.map((stop) => ({
    type: "Feature",
    id: stop.id,
    geometry: {
      type: "Point",
      coordinates: [...stop.location.coordinates] as Position
    },
    properties: {
      kind: "plan-stop",
      planId: document.id,
      schemaVersion: document.schemaVersion,
      order: stop.order,
      name: stop.name,
      dwellMinutes: stop.dwellMinutes,
      status: stop.status ?? null,
      sourceFeatureId: stop.sourceFeatureId ?? null
    }
  }));
  const segmentFeatures = document.segments.flatMap((segment): PlanGeoJsonFeature[] => {
    const alternative = selectedAlternative(segment);
    if (!alternative) return [];
    return [
      {
        type: "Feature",
        id: segment.id,
        geometry: {
          type: "LineString",
          coordinates: alternative.geometry.coordinates.map((position) => [...position] as Position)
        },
        properties: {
          kind: "route-segment",
          planId: document.id,
          schemaVersion: document.schemaVersion,
          order: segment.order,
          fromStopId: segment.fromStopId,
          toStopId: segment.toStopId,
          status: segment.status,
          provider: segment.provider ?? alternative.providerId,
          alternativeId: alternative.id,
          distanceM: alternative.distanceM,
          durationS: alternative.durationS
        }
      }
    ];
  });
  return { type: "FeatureCollection", features: [...stopFeatures, ...segmentFeatures] };
}

export function exportPlanGeoJson(document: PlanDocumentV2): string {
  return `${JSON.stringify(planToGeoJson(document), null, 2)}\n`;
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function coordinate(value: number): string {
  const rounded = Number(value.toFixed(7));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function waypoint(document: PlanDocumentV2, index: number): string[] {
  const stop = document.stops[index]!;
  const [lng, lat] = stop.location.coordinates;
  const lines = [
    `  <wpt lat="${coordinate(lat)}" lon="${coordinate(lng)}">`,
    `    <name>${xml(stop.name)}</name>`
  ];
  const at = stop.arrivalAt ?? stop.departureAt;
  if (at) lines.push(`    <time>${xml(at)}</time>`);
  if (stop.notes) lines.push(`    <desc>${xml(stop.notes)}</desc>`);
  lines.push(`    <type>MapOS stop ${stop.order + 1}</type>`, "  </wpt>");
  return lines;
}

/** Deterministic GPX 1.1 with ordered waypoints and one track segment per available route edge. */
export function exportPlanGpx(document: PlanDocumentV2): string {
  assertPlanDocumentV2(document);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="MapOS" xmlns="http://www.topografix.com/GPX/1/1">',
    "  <metadata>",
    `    <name>${xml(document.name)}</name>`,
    `    <time>${xml(document.updatedAt)}</time>`,
    "  </metadata>"
  ];
  for (let index = 0; index < document.stops.length; index += 1) {
    lines.push(...waypoint(document, index));
  }

  const trackSegments = document.segments.flatMap((segment) => {
    const alternative = selectedAlternative(segment);
    return alternative ? [alternative.geometry.coordinates] : [];
  });
  if (trackSegments.length > 0) {
    lines.push("  <trk>", `    <name>${xml(document.name)}</name>`);
    for (const positions of trackSegments) {
      lines.push("    <trkseg>");
      for (const [lng, lat] of positions) {
        lines.push(`      <trkpt lat="${coordinate(lat)}" lon="${coordinate(lng)}" />`);
      }
      lines.push("    </trkseg>");
    }
    lines.push("  </trk>");
  }
  lines.push("</gpx>");
  return `${lines.join("\n")}\n`;
}

/** KML 2.2 with ordered stop placemarks and one line placemark per selected route segment. */
export function exportPlanKml(document: PlanDocumentV2): string {
  assertPlanDocumentV2(document);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "  <Document>",
    `    <name>${xml(document.name)}</name>`
  ];
  for (const stop of document.stops) {
    const [lng, lat] = stop.location.coordinates;
    lines.push(
      "    <Placemark>",
      `      <name>${xml(`${stop.order + 1}. ${stop.name}`)}</name>`,
      "      <Point>",
      `        <coordinates>${coordinate(lng)},${coordinate(lat)},0</coordinates>`,
      "      </Point>",
      "    </Placemark>"
    );
  }
  for (const segment of document.segments) {
    const alternative = selectedAlternative(segment);
    if (!alternative) continue;
    const from = document.stops[segment.order]?.name ?? segment.fromStopId;
    const to = document.stops[segment.order + 1]?.name ?? segment.toStopId;
    lines.push(
      "    <Placemark>",
      `      <name>${xml(`${from} → ${to}`)}</name>`,
      "      <LineString>",
      "        <tessellate>1</tessellate>",
      `        <coordinates>${alternative.geometry.coordinates
        .map(([lng, lat]) => `${coordinate(lng)},${coordinate(lat)},0`)
        .join(" ")}</coordinates>`,
      "      </LineString>",
      "    </Placemark>"
    );
  }
  lines.push("  </Document>", "</kml>");
  return `${lines.join("\n")}\n`;
}

/** Lossless canonical MapOS package for re-import and future migrations. */
export function exportPlanMapOsJson(document: PlanDocumentV2): string {
  assertPlanDocumentV2(document);
  return `${JSON.stringify(document, null, 2)}\n`;
}
