import { createHash } from "node:crypto";
import {
  CATALOG_DATA,
  CATALOG_GROUPS,
  isMapResultArtifact,
  type MapResultArtifact
} from "@mapos/layer-sdk";
import { sql } from "../../db/index.js";
import type { AiChatAnswer } from "./chatService.js";
export interface MapArtifactRepository {
  put(owner: string, artifact: MapResultArtifact): Promise<void>;
  get(owner: string, id: string): Promise<MapResultArtifact | null>;
}
export const postgresMapArtifacts: MapArtifactRepository = {
  async put(owner, artifact) {
    if (!isMapResultArtifact(artifact)) throw new Error("Invalid map artifact");
    await sql.begin(async (tx) => {
      // Lock the parent against deletion until the artifact is stored. Deletion subsequently
      // removes children; an already deleted conversation cannot acquire new private payloads.
      const parent =
        await tx`SELECT id FROM ai_chat_history WHERE id=${artifact.conversationId} AND owner_user_id=${owner} AND NOT deleted FOR UPDATE`;
      if (!parent.length) return;
      await tx`INSERT INTO ai_map_artifacts(id,owner_user_id,conversation_id,document) VALUES(${artifact.id},${owner},${artifact.conversationId},${JSON.stringify(artifact)}::jsonb) ON CONFLICT(id) DO UPDATE SET document=EXCLUDED.document WHERE ai_map_artifacts.owner_user_id=${owner}`;
    });
  },
  async get(owner, id) {
    const rows =
      await sql`SELECT document FROM ai_map_artifacts WHERE id=${id} AND owner_user_id=${owner}`;
    return (rows[0]?.document as MapResultArtifact) ?? null;
  }
};
export function memoryMapArtifacts(): MapArtifactRepository {
  const rows = new Map<string, { owner: string; artifact: MapResultArtifact }>();
  return {
    async put(owner, artifact) {
      if (!isMapResultArtifact(artifact)) throw new Error("Invalid map artifact");
      if (rows.has(artifact.id) && rows.get(artifact.id)!.owner !== owner)
        throw new Error("Artifact owner mismatch");
      rows.set(artifact.id, { owner, artifact: structuredClone(artifact) });
    },
    async get(owner, id) {
      const row = rows.get(id);
      return row?.owner === owner ? structuredClone(row.artifact) : null;
    }
  };
}
/** Geometries come only from server-grounded answer cards and actual routing results. */
export function answerArtifacts(
  answer: AiChatAnswer,
  conversationId: string,
  revision: number,
  runId = `${conversationId}:${revision}`
): MapResultArtifact[] {
  const places = answer.cards.flatMap((c) =>
    c.type === "places"
      ? c.places
      : c.type === "plan"
        ? c.stops.map((stop, index) => ({
            ...stop,
            id: `stop-${index}`,
            layerId: "ai-plan-stops",
            category: "planned-stop"
          }))
        : []
  );
  const derived = (answer.mapResults ?? [])
    .slice(0, 3)
    .map((result) => ({
      ...result,
      schema: "mapos.map-result" as const,
      schemaVersion: "1.0.0" as const,
      id: `geometry-${createHash("sha256").update(`${conversationId}:${result.id}`).digest("hex").slice(0, 40)}`,
      conversationId,
      runId,
      revision
    }))
    .filter(isMapResultArtifact);
  // The application resolves IDs through its catalogue. No model URL or tile expression
  // enters an artifact, and RGB tiles never masquerade as numerical measurements.
  const rasterIds = new Set<string>();
  for (const card of answer.cards) {
    if (card.type !== "layer") continue;
    for (const id of card.layerIds) {
      const item = CATALOG_GROUPS.flatMap((group) => group.items).find((entry) => entry.id === id);
      const layerId = item?.layer ?? id;
      const metadata = CATALOG_DATA[layerId];
      if (metadata?.geometry !== "raster" || rasterIds.has(layerId)) continue;
      rasterIds.add(layerId);
      const artifact: MapResultArtifact = {
        schema: "mapos.map-result",
        schemaVersion: "1.0.0",
        id: `raster-${createHash("sha256").update(`${conversationId}:${layerId}`).digest("hex").slice(0, 40)}`,
        conversationId,
        runId,
        revision,
        title: item?.cs ?? card.title,
        registeredRaster: { layerId },
        data: { type: "FeatureCollection", features: [] },
        style: { palette: "blue", opacity: card.opacityByLayer?.[id] ?? 0.65 },
        legend: {
          title: metadata.description.slice(0, 200),
          unit: metadata.units,
          time: metadata.time,
          noDataLabel: "Bez dostupného pokrytí; obraz není numerické měření"
        },
        sources: [{ id: `layer:${layerId}`, label: metadata.providerId, url: metadata.sourceUrl }]
      };
      if (isMapResultArtifact(artifact)) derived.push(artifact);
    }
  }
  if (!places.length) return derived;
  const sources = new Map(
    answer.sources.map((s) => [
      s.sourceId,
      {
        id: s.sourceId,
        label: s.label,
        ...(s.url ? { url: s.url } : {}),
        ...(s.retrievedAt ? { retrievedAt: s.retrievedAt } : {})
      }
    ])
  );
  const artifact: MapResultArtifact = {
    schema: "mapos.map-result",
    schemaVersion: "1.0.0",
    id: `places-${createHash("sha256").update(`${conversationId}:${runId}`).digest("hex").slice(0, 40)}`,
    conversationId,
    runId,
    revision,
    title: "Místa z konverzace",
    style: { palette: "blue", opacity: 1 },
    sources: [...sources.values()],
    data: {
      type: "FeatureCollection",
      features: [
        ...new Map(
          places
            .filter((p) => sources.has(p.sourceId))
            .map((p) => [
              `${p.layerId}:${p.id}`,
              {
                type: "Feature" as const,
                id: `${p.layerId}:${p.id}`,
                geometry: {
                  type: "Point" as const,
                  coordinates: [p.longitude, p.latitude] as [number, number]
                },
                properties: {
                  title: p.title,
                  sourceId: p.sourceId,
                  layerId: p.layerId,
                  sourceFeatureId: p.sourceFeatureId ?? p.id
                }
              }
            ])
        ).values()
      ]
    }
  };
  return [
    ...derived,
    ...(artifact.data.features.length && isMapResultArtifact(artifact) ? [artifact] : [])
  ];
}
