/**
 * Theme manifests: the switchable questions in §23.
 *
 * A theme names a unit and a set of sources with roles, and deliberately does *not* name a
 * dataset to draw. That indirection is the feature: "Crime" stays one switch while the data
 * under it changes with the viewport, and adding a national register to a theme is a manifest
 * edit rather than a new layer in the drawer.
 */

export const MAPOS_THEME_SCHEMA = "mapos.theme" as const;

export type ThemeSourceRoleV2 = "primary" | "detail" | "point";
export type ThemeNormalizationV2 = "raw" | "per_100k" | "per_km2" | "percent";
export type ThemeDirectionV2 = "higher-is-worse" | "higher-is-better" | "neutral";

export interface ThemeSourceV2 {
  datasetId: string;
  role: ThemeSourceRoleV2;
  themeMapping?: {
    valueField?: string;
    multiplier?: number;
    /** Population series to divide by when the theme is per-capita and the source counts. */
    perCapitaDatasetId?: string;
  };
}

export interface ThemeManifestV2 {
  schema: typeof MAPOS_THEME_SCHEMA;
  schemaVersion: "2.0.0";
  id: string;
  name: string;
  icon?: string;
  unit: string;
  normalization?: ThemeNormalizationV2;
  directionGoodBad?: ThemeDirectionV2;
  /** Fixed bounds, when comparability beats local contrast. Absent means quantiles. */
  classBreaks?: number[];
  sources: ThemeSourceV2[];
  legend?: {
    title?: string;
    classes?: number;
    method?: "quantile" | "equal-interval" | "manual";
  };
  disclosure?: string;
  /**
   * Translations of the three reader-facing strings, keyed by language.
   *
   * The top-level `name`, `unit` and `disclosure` are the fallback and are written in English,
   * which is the language the interface opens in. A theme that ships no translations is still a
   * valid theme — it just reads the same in every language.
   */
  i18n?: Record<string, ThemeTextV2>;
}

export interface ThemeTextV2 {
  name?: string;
  unit?: string;
  disclosure?: string;
}

export function isThemeManifestV2(value: unknown): value is ThemeManifestV2 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ThemeManifestV2>;
  return (
    candidate.schema === MAPOS_THEME_SCHEMA &&
    candidate.schemaVersion === "2.0.0" &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.unit === "string" &&
    Array.isArray(candidate.sources)
  );
}

/**
 * The theme's reader-facing strings in one language.
 *
 * Resolved field by field rather than whole-object: a translation that names the theme but not
 * its unit should show the translated name next to the English unit, not fall back entirely.
 */
export function themeText(
  theme: ThemeManifestV2,
  locale: string
): { name: string; unit: string; disclosure?: string } {
  const translated = theme.i18n?.[locale] ?? theme.i18n?.[locale.slice(0, 2)];
  return {
    name: translated?.name ?? theme.name,
    unit: translated?.unit ?? theme.unit,
    disclosure: translated?.disclosure ?? theme.disclosure
  };
}

/** `directionGoodBad` as the boolean the renderer actually branches on. */
export function higherIsWorse(theme: ThemeManifestV2): boolean {
  return theme.directionGoodBad === "higher-is-worse";
}
