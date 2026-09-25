import type { PlanDocumentV2 } from "@mapos/layer-sdk";
import { apiPost } from "../lib/api";

export const PLAN_EXPORT_LABELS = {
  gpx: "GPX",
  geojson: "GeoJSON",
  kml: "KML",
  mapos: "MapOS JSON"
} as const;

export type PlanExportFormat = keyof typeof PLAN_EXPORT_LABELS;

interface PlanExportResponse {
  filename: string;
  mimeType: string;
  content: string;
}

/** The API owns every format, so exporting is one request plus a synthetic download. */
export async function exportPlanDocument(
  plan: PlanDocumentV2,
  format: PlanExportFormat
): Promise<void> {
  const data = await apiPost<PlanExportResponse>(`/v2/plans/export/${format}`, { plan });
  const url = URL.createObjectURL(new Blob([data.content], { type: data.mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = data.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
