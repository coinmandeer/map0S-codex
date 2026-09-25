import {
  CATALOG_DATA,
  isMapResultArtifact,
  type GeoFeature,
  type MapResultArtifact,
  type MapResultDraft
} from "@mapos/layer-sdk";

/** Only registered provider data crosses this boundary; model text never supplies geometry. */
export function layerMapResult(
  layerId: string,
  rows: GeoFeature[],
  limit: number
): MapResultDraft | undefined {
  const metadata = CATALOG_DATA[layerId];
  if (!metadata || !metadata.operations.includes("query-features")) return undefined;
  const sourceId = `layer:${layerId}`;
  const draft: MapResultDraft = {
    id: `layer-result-${layerId}`,
    title: metadata.description.split(".")[0]!,
    sources: [
      {
        id: sourceId,
        label: metadata.providerId,
        url: metadata.sourceUrl,
        retrievedAt: new Date().toISOString()
      }
    ],
    style: { palette: "blue", opacity: 0.65 },
    data: { type: "FeatureCollection", features: [] }
  };
  if (layerId === "aurora") {
    draft.style = { palette: "blue", opacity: 0.7, minimum: 0, maximum: 100 };
    draft.legend = {
      title: "OVATION · modelový odhad; větší buňky uvádějí maximum",
      unit: "%",
      time: String(rows[0]?.properties.forecastAt ?? metadata.time),
      noDataLabel: "Bez dat"
    };
  }
  if (layerId === "disaster-impacts") {
    draft.style = {
      palette: "categories",
      opacity: 0.55,
      categories: ["Green", "Orange", "Red", "Unknown"]
    };
    draft.legend = {
      title: "GDACS · kategorie výstrahy, nikoli záruka bezpečného přístupu",
      unit: "kategorie GDACS",
      time: "Posledních 7 dní; poslední dostupná epizoda",
      noDataLabel: "Neznámá výstraha"
    };
  }
  const append = (feature: unknown) => {
    const candidate = {
      ...draft,
      schema: "mapos.map-result",
      schemaVersion: "1.0.0",
      conversationId: "validation",
      runId: "validation",
      revision: 0,
      data: { type: "FeatureCollection", features: [feature] }
    };
    if (!isMapResultArtifact(candidate)) return;
    // Keep tool output below its envelope; never cut a ring or truncate a route's coordinates.
    if (
      Buffer.byteLength(JSON.stringify(draft)) + Buffer.byteLength(JSON.stringify(feature)) >
      170000
    )
      return;
    draft.data.features.push(candidate.data.features[0]!);
  };
  for (const row of rows.slice(0, Math.min(50, Math.max(0, limit)))) {
    const p = row.properties,
      id = String(p.id ?? `${layerId}:${draft.data.features.length}`);
    let geometry: unknown = row.geometry;
    const properties: MapResultArtifact["data"]["features"][number]["properties"] = {
      title: String(p.name ?? id).slice(0, 500),
      sourceId,
      layerId,
      sourceFeatureId: id
    };
    if (layerId === "aurora") {
      const b = p.cellBounds;
      if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) continue;
      geometry = {
        type: "Polygon",
        coordinates: [
          [
            [b[0], b[1]],
            [b[2], b[1]],
            [b[2], b[3]],
            [b[0], b[3]],
            [b[0], b[1]]
          ]
        ]
      };
      properties.value =
        typeof p.probability === "number" && p.probability >= 0 && p.probability <= 100
          ? p.probability
          : null;
    }
    if (layerId === "disaster-impacts")
      properties.category = ["Green", "Orange", "Red"].includes(String(p.alert))
        ? String(p.alert)
        : "Unknown";
    append({ type: "Feature", id, geometry, properties });
    if (layerId === "disaster-impacts" && Array.isArray(p.footprints))
      for (const [index, footprint] of p.footprints.slice(0, 10).entries()) {
        if (!footprint || typeof footprint !== "object") continue;
        append({
          type: "Feature",
          id: `${id}:area:${index}`,
          geometry: footprint.geometry,
          properties: {
            ...properties,
            title: `${properties.title} · ${String(footprint.label ?? "Modelovaná oblast").slice(0, 200)}`
          }
        });
      }
  }
  return draft.data.features.length ? draft : undefined;
}
