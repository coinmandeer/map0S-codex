/**
 * A user's imported table, drawn as a choropleth.
 *
 * Deliberately the same machinery as a theme: the server classifies the values, the client
 * registers a layer whose renderer is `choropleth` and whose legend comes from the class breaks.
 * A spreadsheet someone uploaded and a European statistical series therefore look and behave the
 * same on the map, which is the point — one is not a lesser kind of data than the other.
 */

import type { LayerManifestV2, LegendManifestV2 } from "@mapos/layer-sdk";
import { API_BASE, apiGet } from "../../lib/api";
import { safeBrowserErrorFields } from "../../lib/safeError";
import { allLayerPlugins, getLayerManifestV2, registerLayerV2, unregisterLayer } from "../registry";
import { createChoroplethLayer, NO_DATA_COLOR, type ChoroplethBreak } from "./choropleth";
import { formatValue } from "./themeLayers";

export interface UserTableSummary {
  id: string;
  name: string;
  datasetId: string;
  geoLevel: string;
  valueLabel: string;
  unit: string | null;
  period: string;
  sourceUrl: string | null;
  refreshIntervalMinutes: number | null;
}

export interface UserTableDetail {
  table: UserTableSummary;
  periods: string[];
  period: string | null;
  breaks: ChoroplethBreak[];
  ready: boolean;
}

const PREFIX = "table-";

export function tableLayerId(tableId: string): string {
  return `${PREFIX}${tableId.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}`;
}

export async function fetchUserTables(signal?: AbortSignal): Promise<UserTableSummary[]> {
  const data = await apiGet<{ tables: UserTableSummary[] }>("/v2/tables", { auth: true, signal });
  return data.tables;
}

export async function fetchUserTable(id: string, signal?: AbortSignal): Promise<UserTableDetail> {
  return apiGet<UserTableDetail>(`/v2/tables/${encodeURIComponent(id)}`, { auth: true, signal });
}

/**
 * Reads the user's tables and registers a layer for each one that has values.
 *
 * The detail request per table is what carries the class breaks, and those are computed from the
 * whole series — a legend built from the list would describe classes the map does not draw. A
 * table whose detail fails is skipped rather than failing the rest, because one bad import
 * should not empty the section.
 */
export async function refreshTableLayers(): Promise<string[]> {
  let tables: UserTableSummary[];
  try {
    tables = await fetchUserTables();
  } catch {
    // A guest with no tables, or an API that is not there. Neither deserves a message in a panel
    // the user opened to look at something else.
    return [];
  }
  const details = await Promise.all(
    tables.map((table) => fetchUserTable(table.id).catch(() => null))
  );
  return syncTableLayers(details.filter((detail): detail is UserTableDetail => detail !== null));
}

/** Registers a layer per table that has values, and removes the ones that no longer do. */
export function syncTableLayers(tables: readonly UserTableDetail[]): string[] {
  const wanted = new Map(
    tables.filter((entry) => entry.ready).map((entry) => [tableLayerId(entry.table.id), entry])
  );

  for (const id of registeredTableLayerIds()) {
    if (!wanted.has(id)) unregisterLayer(id);
  }
  for (const [id, detail] of wanted) {
    const current = getLayerManifestV2(id);
    // A refreshed table keeps its id and changes its numbers, so the tile URL carries the period
    // and the layer is rebuilt when that moves.
    if (current && current.source.tileTemplate !== tileTemplate(detail)) unregisterLayer(id);
  }

  const present = new Set(registeredTableLayerIds());
  const added: string[] = [];
  for (const [id, detail] of wanted) {
    if (present.has(id)) continue;
    try {
      registerTableLayer(id, detail);
    } catch (error) {
      console.warn(`Tabulku „${detail.table.name}" nejde zobrazit.`, safeBrowserErrorFields(error));
      continue;
    }
    added.push(id);
  }
  return added;
}

function registeredTableLayerIds(): string[] {
  return allLayerPlugins()
    .map((plugin) => plugin.manifest.id)
    .filter((id) => id.startsWith(PREFIX));
}

function tileTemplate(detail: UserTableDetail): string {
  return `${API_BASE}/v2/tables/${detail.table.id}/tiles/{z}/{x}/{y}.pbf`;
}

function registerTableLayer(id: string, detail: UserTableDetail): void {
  const label = detail.table.unit ?? detail.table.valueLabel;
  const manifest: LayerManifestV2 = {
    schema: "mapos.layer-manifest",
    schemaVersion: "2.0.0",
    sdkRange: "^2.0.0",
    minimumRuntime: "19.0.0",
    id,
    name: detail.table.name,
    description: `${label} · ${detail.period ?? detail.table.period}`,
    category: "statistics",
    geometryKinds: ["Polygon"],
    renderer: { type: "choropleth" },
    source: {
      type: "vector-tiles",
      tileTemplate: tileTemplate(detail),
      adapterId: "user-table"
    },
    queryPolicy: { strategy: "tile" },
    capabilities: [],
    // The uploader is the source. Naming them rather than leaving it blank is what keeps an
    // imported table from looking like an official series once it is on the map next to one.
    attribution: [{ label: "Vlastní tabulka" }],
    legend: legendForTable(detail)
  };

  registerLayerV2({
    manifest,
    create: (ctx) =>
      createChoroplethLayer(ctx.map, ctx.layerId, {
        tiles: [tileTemplate(detail)],
        sourceLayer: "units",
        breaks: detail.breaks,
        attribution: "Vlastní tabulka"
      })
  });
}

export function legendForTable(detail: UserTableDetail): LegendManifestV2 {
  return {
    type: "continuous",
    title: detail.table.name,
    unit: detail.table.unit ?? detail.table.valueLabel,
    ...(detail.breaks.length
      ? {
          min: detail.breaks[0]!.from,
          max: detail.breaks[detail.breaks.length - 1]!.to,
          stops: detail.breaks.map((entry) => ({
            value: entry.from,
            label: `${formatValue(entry.from)} – ${formatValue(entry.to)}`,
            color: entry.color
          }))
        }
      : {}),
    items: [
      { label: "Bez dat", color: NO_DATA_COLOR, description: "Tabulka tuhle oblast neobsahuje" }
    ]
  };
}
