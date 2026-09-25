import {
  MAPOS_LAYER_SDK_RANGE,
  type Bbox,
  type InlineFeatureV2,
  type LayerManifestV2
} from "@mapos/layer-sdk";
export const AI_RESULT_PREFIX = "ai-answer-";
let serial = 0;
export interface AnswerPlace {
  sourceFeatureId?: string;
  id: string;
  layerId: string;
  title: string;
  longitude: number;
  latitude: number;
  category?: string;
  sourceId: string;
}
export function answerResultManifest(
  title: string,
  places: readonly AnswerPlace[],
  sources: readonly { sourceId: string; label: string; url?: string }[]
): LayerManifestV2 {
  const seen = new Set<string>();
  const features: InlineFeatureV2[] = [];
  for (const place of places) {
    const key = JSON.stringify([place.layerId, place.id]);
    if (seen.has(key) || features.length >= 100) continue;
    seen.add(key);
    if (
      !Number.isFinite(place.longitude) ||
      !Number.isFinite(place.latitude) ||
      Math.abs(place.longitude) > 180 ||
      Math.abs(place.latitude) > 90
    )
      continue;
    features.push({
      id: `result-${features.length}`,
      title: place.title,
      longitude: place.longitude,
      latitude: place.latitude,
      category: place.category,
      sourceId: place.sourceId,
      sourceLayerId: place.layerId,
      sourceFeatureId: place.sourceFeatureId ?? place.id
    });
  }
  return {
    schema: "mapos.layer-manifest",
    schemaVersion: "2.0.0",
    sdkRange: MAPOS_LAYER_SDK_RANGE,
    id: `${AI_RESULT_PREFIX}${++serial}`,
    name: `AI: ${title}`.slice(0, 120),
    description: "Místa vybraná v odpovědi. Dočasný výběr, bez načítání celých zdrojových vrstev.",
    category: "user",
    icon: "auto_awesome",
    color: "#7C4DFF",
    modes: ["discover", "planning"],
    geometryKinds: ["Point"],
    renderer: { type: "symbols", style: { iconByCategory: true }, zIndex: 620 },
    source: { type: "inline", inline: { generatedAt: new Date().toISOString(), features } },
    queryPolicy: { strategy: "manual" },
    attribution: sources
      .filter((s) => features.some((f) => f.sourceId === s.sourceId))
      .map((s) => ({ label: s.label, ...(s.url ? { url: s.url } : {}), requiredOnMap: true })),
    capabilities: ["query"]
  };
}
export function temporaryAnswerManifest(manifest: LayerManifestV2): LayerManifestV2 {
  if (!manifest.source.inline) throw new Error("Expected inline answer results");
  return {
    ...manifest,
    id: `${AI_RESULT_PREFIX}${++serial}`,
    source: {
      ...manifest.source,
      inline: { ...manifest.source.inline, features: manifest.source.inline.features.slice(0, 100) }
    }
  };
}
/** Shortest longitude interval also fits results straddling the dateline. */
export function answerBounds(
  points: readonly { longitude: number; latitude: number }[]
): Bbox | null {
  const valid = points.filter(
    (p) =>
      Number.isFinite(p.longitude) &&
      Number.isFinite(p.latitude) &&
      Math.abs(p.latitude) <= 90 &&
      Math.abs(p.longitude) <= 180
  );
  if (!valid.length) return null;
  const lngs = valid.map((p) => (p.longitude + 360) % 360).sort((a, b) => a - b);
  let gap = -1,
    start = 0;
  for (let i = 0; i < lngs.length; i++) {
    const next = i + 1 < lngs.length ? lngs[i + 1]! : lngs[0]! + 360;
    if (next - lngs[i]! > gap) {
      gap = next - lngs[i]!;
      start = (i + 1) % lngs.length;
    }
  }
  let west = lngs[start]!,
    east = west + 360 - gap;
  if (west > 180) {
    west -= 360;
    east -= 360;
  }
  return [
    west,
    Math.min(...valid.map((p) => p.latitude)),
    east,
    Math.max(...valid.map((p) => p.latitude))
  ];
}
