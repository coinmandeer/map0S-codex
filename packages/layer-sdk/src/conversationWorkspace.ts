import { isMapResultArtifact } from "./mapScene.js";
import { isPlanDocumentV2, validateLayerManifestV2 } from "./v2/index.js";
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export function isConversationWorkspaceData(value: unknown): value is Record<string, unknown> {
  if (!object(value) || !object(value.appearance) || !object(value.view)) return false;
  const a = value.appearance,
    v = value.view;
  if (
    !finite(v.lng) ||
    Math.abs(v.lng) > 180 ||
    !finite(v.lat) ||
    Math.abs(v.lat) > 90 ||
    !finite(v.zoom) ||
    v.zoom < 0 ||
    v.zoom > 24
  )
    return false;
  if (
    typeof a.basemapId !== "string" ||
    !["basemapLabels", "buildings3d", "terrain3d"].every((k) => typeof a[k] === "boolean") ||
    !object(a.poiSources) ||
    !Object.values(a.poiSources).every((v) => typeof v === "boolean") ||
    !object(a.layers) ||
    Object.keys(a.layers).length > 500
  )
    return false;
  if (
    !Object.values(a.layers).every(
      (l) =>
        object(l) &&
        typeof l.visible === "boolean" &&
        finite(l.opacity) &&
        l.opacity >= 0 &&
        l.opacity <= 1 &&
        object(l.filters)
    )
  )
    return false;
  if (value.area !== undefined && value.area !== null) {
    const area = value.area;
    if (
      !object(area) ||
      !["id", "revision", "name", "country", "source", "code"].every(
        (k) => typeof area[k] === "string"
      ) ||
      !["country", "adm1", "adm2", "lau"].includes(String(area.level)) ||
      !Array.isArray(area.bbox) ||
      area.bbox.length !== 4 ||
      !area.bbox.every(finite)
    )
      return false;
  }
  if (
    value.temporal !== undefined &&
    (!object(value.temporal) ||
      !["live", "preview"].includes(String(value.temporal.mode)) ||
      typeof value.temporal.cursor !== "string" ||
      !Number.isFinite(Date.parse(value.temporal.cursor)))
  )
    return false;
  if (value.statistic !== undefined && value.statistic !== null) {
    const stat = value.statistic;
    if (
      !object(stat) ||
      typeof stat.id !== "string" ||
      !/^[a-z][a-z0-9-]{1,40}$/.test(stat.id) ||
      typeof stat.period !== "string" ||
      !/^(latest|[0-9]{4})$/.test(stat.period) ||
      !Array.isArray(stat.excluded) ||
      stat.excluded.length > 50 ||
      !stat.excluded.every((id) => typeof id === "string" && /^[a-z0-9-]+$/.test(id))
    )
      return false;
  }
  if (value.plan !== null && !isPlanDocumentV2(value.plan)) return false;
  if (value.result !== null && !validateLayerManifestV2(value.result).valid) return false;
  if (
    value.artifactIds !== undefined &&
    (!Array.isArray(value.artifactIds) ||
      value.artifactIds.length > 30 ||
      !value.artifactIds.every(
        (id) => typeof id === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(id)
      ) ||
      new Set(value.artifactIds).size !== value.artifactIds.length)
  )
    return false;
  if (
    value.artifacts !== undefined &&
    (!Array.isArray(value.artifacts) ||
      value.artifacts.length > 30 ||
      !value.artifacts.every(isMapResultArtifact))
  )
    return false;
  if (value.route !== null) {
    const r = value.route;
    if (
      !object(r) ||
      !finite(r.distanceM) ||
      r.distanceM < 0 ||
      !finite(r.durationS) ||
      r.durationS < 0 ||
      !Array.isArray(r.coordinates) ||
      r.coordinates.length > 100000 ||
      !r.coordinates.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          p.every(finite) &&
          Math.abs(p[0]) <= 180 &&
          Math.abs(p[1]) <= 90
      )
    )
      return false;
  }
  return true;
}
