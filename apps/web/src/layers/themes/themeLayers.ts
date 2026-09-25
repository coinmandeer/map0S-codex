import type { LayerManifestV2, LegendManifestV2 } from "@mapos/layer-sdk";
import { safeBrowserErrorFields } from "../../lib/safeError";
import { API_BASE } from "../../lib/api";
import { registerLayerV2, unregisterLayer, allLayerPlugins, getLayerManifestV2 } from "../registry";
import { createChoroplethLayer, NO_DATA_COLOR, type ChoroplethBreak } from "./choropleth";
import { intlLocale, t } from "../../i18n";

/**
 * Themes as layers.
 *
 * A theme is registered the same way any other layer is, which is the whole point of §23.3's
 * "one switch per theme": the Layers drawer, the attribution control, the AI catalogue and the
 * URL state all read the registry, so a theme needs no parallel machinery to be switchable,
 * creditable or searchable.
 *
 * The manifests are built at runtime from `/v2/themes` rather than written by hand, because the
 * class breaks come from the data. Hardcoding them would mean the legend and the map disagreed
 * the first time an import changed the distribution.
 */

export interface ThemeSummary {
  id: string;
  name: string;
  icon: string;
  unit: string;
  higherIsWorse: boolean;
  disclosure?: string;
  sourceCount: number;
  available?: boolean;
  coverageStatus?: "none" | "partial" | "full" | "unknown";
  geoLevels?: string[];
  group?: string;
}

export interface ThemeDetail extends ThemeSummary {
  period: string | null;
  /** Datasets the user switched off in the Sources popover; they leave the tile URL. */
  excluded?: string[];
  periods: string[];
  breaks: ChoroplethBreak[];
  ready: boolean;
  zoom?: number;
  selectedGeoLevel?: string;
  selectedDatasetId?: string;
  revision?: string;
  observations?: number;
  coverageBbox?: [number, number, number, number] | null;
  dataStatus?: string;
  geometryProfile?: "open" | "noncommercial";
  imports?: Array<{
    dataset_id: string;
    status: string;
    published_at: string | null;
    observations: number;
    territories: number;
    unmatched: number;
    error: string | null;
  }>;
  sources: Array<{
    available?: boolean;
    datasetId: string;
    name: string;
    role: string;
    geoLevel: string;
    attribution: string;
    license: string;
    documentationUrl: string;
  }>;
}

const PREFIX = "theme-";

export function themeLayerId(themeId: string): string {
  return `${PREFIX}${themeId}`;
}

/**
 * Registers a layer per theme that has data, and removes the ones that no longer do.
 *
 * A theme with no imported series is deliberately absent rather than present and empty: an
 * overlay that draws nothing looks like a bug, and the section header already says what exists.
 */
export function syncThemeLayers(themes: readonly ThemeDetail[]): string[] {
  const wanted = new Map(
    themes
      .filter((entry) => entry.ready && entry.period)
      .map((entry) => [themeLayerId(entry.id), entry])
  );

  for (const id of registeredThemeLayerIds()) {
    if (!wanted.has(id)) unregisterLayer(id);
  }

  // A theme already registered may still need rebuilding: switching a source off or moving to
  // another period changes the tile URL, and a layer whose manifest kept the old one would keep
  // drawing the data the user just excluded.
  for (const [id, detail] of wanted) {
    const current = getLayerManifestV2(id);
    if (current && current.source.tileTemplate !== tileTemplate(detail)) unregisterLayer(id);
  }

  const present = new Set(registeredThemeLayerIds());
  const added: string[] = [];
  for (const [id, detail] of wanted) {
    if (present.has(id)) continue;
    try {
      registerThemeLayer(id, detail);
    } catch (error) {
      // One theme whose manifest fails validation must not take the rest of the section with it.
      console.warn(`Theme "${detail.name}" cannot be switched on.`, safeBrowserErrorFields(error));
      continue;
    }
    added.push(id);
  }
  return added;
}

function registeredThemeLayerIds(): string[] {
  return allLayerPlugins()
    .map((plugin) => plugin.manifest.id)
    .filter((id) => id.startsWith(PREFIX));
}

function registerThemeLayer(id: string, detail: ThemeDetail): void {
  const manifest: LayerManifestV2 = {
    schema: "mapos.layer-manifest",
    schemaVersion: "2.0.0",
    sdkRange: "^2.0.0",
    minimumRuntime: "19.0.0",
    id,
    name: detail.name,
    description: `${detail.unit} · ${periodLabel(detail)}`,
    category: "statistics",
    activation: {
      preferredMode: "discover",
      compatibleModes: ["discover"],
      exclusiveGroup: "statistical-fill"
    },
    temporal: { enabled: true, timelinePriority: 30 },
    geometryKinds: ["Polygon"],
    renderer: { type: "choropleth" },
    source: {
      type: "vector-tiles",
      tileTemplate: tileTemplate(detail),
      adapterId: "stat-series"
    },
    queryPolicy: { strategy: "tile" },
    capabilities: [],
    attribution: [
      ...(detail.selectedGeoLevel === "lau"
        ? [
            {
              label: "© EuroGeographics / Eurostat GISCO LAU 2024",
              url: "https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/local-administrative-units"
            }
          ]
        : []),
      {
        label:
          detail.geometryProfile === "noncommercial"
            ? "Natural Earth / GISCO · see geometry terms"
            : "Natural Earth · public domain",
        url:
          detail.geometryProfile === "noncommercial"
            ? "https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units"
            : "https://www.naturalearthdata.com/about/terms-of-use/"
      },
      ...detail.sources.map((source) => ({
        label: source.attribution,
        url: source.documentationUrl
      }))
    ],
    legend: legendFor(detail)
  };

  registerLayerV2({
    manifest,
    create: (ctx) =>
      createChoroplethLayer(ctx.map, ctx.layerId, {
        tiles: [tileTemplate(detail)],
        sourceLayer: "units",
        breaks: detail.breaks,
        unit: detail.unit,
        attribution: detail.sources.map((source) => source.attribution).join(", ")
      })
  });
}

function tileTemplate(detail: ThemeDetail): string {
  return (
    `${API_BASE}/v2/themes/${detail.id}/tiles/{z}/{x}/{y}.pbf` +
    themeQuery({
      period: detail.period ?? undefined,
      excluded: detail.excluded,
      zoom: detail.zoom
    }) +
    (detail.revision ? `&revision=${encodeURIComponent(detail.revision)}` : "")
  );
}

/** `?period=&exclude=`, or nothing at all when neither applies. Shared with the catalogue so a
 *  tile URL and the requests that describe it never disagree about what is switched off. */
export function themeQuery(options: {
  period?: string;
  excluded?: readonly string[];
  zoom?: number;
}): string {
  const params = new URLSearchParams();
  if (options.zoom !== undefined) params.set("zoom", String(options.zoom));
  if (options.period) params.set("period", options.period);
  if (options.excluded?.length) params.set("exclude", [...options.excluded].sort().join(","));
  const query = params.toString();
  return query ? `?${query}` : "";
}

function periodLabel(detail: ThemeDetail): string {
  return detail.period === "latest"
    ? "Latest available"
    : detail.period
      ? t("themes.dataFor", { period: detail.period })
      : t("themes.noData");
}

/**
 * `continuous`, with the class bounds as stops.
 *
 * The "no data" row is part of the key rather than a footnote: the hatch is on the map, so it
 * has to be in the legend, or the reader is left guessing what the stripes mean.
 */
export function legendFor(detail: ThemeDetail): LegendManifestV2 {
  return {
    type: "continuous",
    title: detail.name,
    unit: detail.unit,
    ...(detail.breaks.length
      ? {
          min: detail.breaks[0]!.from,
          max: detail.breaks[detail.breaks.length - 1]!.to,
          stops: detail.breaks.map((entry) => ({
            value: entry.from,
            label: rangeLabel(entry),
            color: entry.color
          }))
        }
      : {}),
    items: [
      {
        label: t("themes.legend.noData"),
        color: NO_DATA_COLOR,
        description: t("themes.legend.noData.description")
      }
    ]
  };
}

function rangeLabel(entry: ChoroplethBreak): string {
  return `${formatValue(entry.from)} – ${formatValue(entry.to)}`;
}

/** Thousands separated, decimals only where they carry information: a crime rate of 811.4 keeps
 *  its tenth, a population of 10 900 555 does not gain one. */
export function formatValue(value: number): string {
  const decimals = Math.abs(value) < 100 ? 1 : 0;
  return value.toLocaleString(intlLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
}
