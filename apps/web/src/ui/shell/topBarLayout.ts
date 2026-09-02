/** How the top bar pill decides what it can afford to show (§3.1, §4.1).
 *
 *  The pill is centred over the map area, so the space it has is not the viewport width: the
 *  left panel and the right drawer eat into it, and the hamburger and the Podklady/Vrstvy rail
 *  sit in the same strip. Deciding label visibility from `window.innerWidth` — what the first
 *  pass did — is why the 1440 px screenshot showed "Plánov" under the basemap button: the
 *  viewport was wide, the strip between the open sidebar and the rail was not.
 *
 *  Things are given up in order of how much work they do. The wordmark and then the logo go
 *  first (the phone layout has no brand at all, per the brief), and the mode labels only after
 *  that, because a named mode is the one thing in the pill a newcomer can read.
 *
 *  Widths are measured from a rendered bar at 1600 px (Inter, 15/14 px): brand 98 · search 280 ·
 *  modes 363 with labels / 188 icon-only · settings 40 · dividers and gaps ≈ 56 · padding 24.
 */

export type BrandDisplay = "full" | "logo" | "none";

/** Pill width with the wordmark, the logo and every mode label. */
export const TOP_BAR_FULL_W = 864;
/** …without the "MapOS" wordmark. */
export const TOP_BAR_LOGO_ONLY_W = 804;
/** …without the brand entirely, mode labels still shown. */
export const TOP_BAR_NO_BRAND_W = 757;
/** The trailing "Poloha" label inside the search field. */
export const LOCATION_LABEL_W = 56;

export interface TopBarLayout {
  brand: BrandDisplay;
  showModeLabels: boolean;
  showLocationLabel: boolean;
}

const MIN_FOR_LABELS: Record<BrandDisplay, number> = {
  full: TOP_BAR_FULL_W,
  logo: TOP_BAR_LOGO_ONLY_W,
  none: TOP_BAR_NO_BRAND_W
};

export function topBarLayout({ available }: { available: number }): TopBarLayout {
  const brand: BrandDisplay =
    available >= TOP_BAR_FULL_W ? "full" : available >= TOP_BAR_LOGO_ONLY_W ? "logo" : "none";
  const showModeLabels = available >= MIN_FOR_LABELS[brand];
  return {
    brand,
    showModeLabels,
    // The least useful of the three, so it only appears when the pill is comfortably wide.
    showLocationLabel: brand === "full" && available >= TOP_BAR_FULL_W + LOCATION_LABEL_W
  };
}

export interface ChromeStripInput {
  viewport: number;
  /** Width of the docked left panel, 0 when closed. */
  sidebar: number;
  /** Width of the right utility drawer, 0 when closed. */
  drawer: number;
  /** Measured width of the Podklady/Vrstvy rail. */
  rail: number;
  /** True while the floating hamburger occupies the left corner. */
  hamburger: boolean;
  /** `--chrome-inset`. */
  inset: number;
}

const HAMBURGER_W = 40;

/** The strip left for the pill between the panel edge, the hamburger and the utility rail. */
export function chromeStripWidth({
  viewport,
  sidebar,
  drawer,
  rail,
  hamburger,
  inset
}: ChromeStripInput): number {
  const left = sidebar + inset + (hamburger ? HAMBURGER_W + inset : 0);
  const right = drawer + inset + (rail > 0 ? rail + inset : 0);
  return Math.max(0, viewport - left - right);
}

/** The narrowest honest pill on a desktop: a search field down to its 168 px floor, icon-only
 *  modes, the settings button, dividers, gaps and padding. */
export const PILL_FLOOR_W = 430;
/** The Podklady/Vrstvy rail as a row with both labels. */
export const RAIL_ROW_W = 256;
/** …and as a vertical column of icon-only buttons, the phone composition (§3.2). */
export const RAIL_COLUMN_W = 44;

export interface ChromeCompositionInput {
  /** Width of the strip left by the panel and the drawer — the utility slot, rail included. */
  strip: number;
  /** True while the floating hamburger occupies the left corner. */
  hamburger: boolean;
  /** `--chrome-inset`. */
  inset: number;
}

export interface ChromeComposition {
  /** The rail becomes a vertical column of icon-only buttons so the pill keeps its full row. */
  railStacked: boolean;
  /** The settings button moves from the pill into the rail, where the phone layout keeps it. */
  compact: boolean;
}

/** What the top bar can hold once the panel and the drawer have taken their share (§3.1).
 *
 *  A 900 px window with the 360 px sidebar open leaves 248 px beside a full-width rail — less
 *  than half of what the pill needs. Rather than letting the pill slide underneath the Vrstvy
 *  button, the rail stands up as a column first, and only if that is still not enough does the
 *  pill hand the settings button over to it. */
export function chromeComposition({
  strip,
  hamburger,
  inset
}: ChromeCompositionInput): ChromeComposition {
  const forPill = (railWidth: number) =>
    strip - (hamburger ? HAMBURGER_W + inset : 0) - railWidth - inset;
  const railStacked = forPill(RAIL_ROW_W) < PILL_FLOOR_W;
  return {
    railStacked,
    compact: forPill(RAIL_COLUMN_W) < PILL_FLOOR_W
  };
}
