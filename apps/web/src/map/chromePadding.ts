export interface ChromeInsets {
  /** Bottom edge of the floating top bar. */
  topBarBottom: number;
  /** Width of the open left sidebar, 0 when closed or on mobile. */
  sidebarWidth: number;
  /** Width of the open right drawer, 0 when closed or on mobile. */
  drawerWidth: number;
  /** Height of the mobile bottom sheet, 0 when there is none. */
  sheetHeight: number;
  /** Height of the mobile navigation bar. */
  bottomNavHeight: number;
  /** Height of the footer stack (legend, timeline) when present. */
  footerHeight: number;
}

export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Breathing room so a centred target is not flush against the chrome that borders it. */
const GUTTER = 16;

/** MapLibre padding that matches the chrome currently covering the map.
 *
 *  Everything that centres something — `easeTo` on a picked place, `fitBounds` on a route —
 *  goes through this, which is why the mobile sheet can be dragged to 92 % of the screen
 *  without the selected pin disappearing under it: the visible strip becomes the whole
 *  viewport as far as the camera is concerned.
 */
export function chromeMapPadding(
  insets: ChromeInsets,
  viewport: { width: number; height: number }
): MapPadding {
  const raw = {
    top: insets.topBarBottom + GUTTER,
    right: insets.drawerWidth + GUTTER,
    bottom: Math.max(insets.sheetHeight, insets.footerHeight) + insets.bottomNavHeight + GUTTER,
    left: insets.sidebarWidth + GUTTER
  };
  // MapLibre throws if the padding leaves no room; clamp each axis to 80 % of it.
  const maxHorizontal = viewport.width * 0.8;
  const maxVertical = viewport.height * 0.8;
  const scale = (a: number, b: number, max: number) =>
    a + b <= max ? ([a, b] as const) : ([(a / (a + b)) * max, (b / (a + b)) * max] as const);
  const [left, right] = scale(raw.left, raw.right, maxHorizontal);
  const [top, bottom] = scale(raw.top, raw.bottom, maxVertical);
  return {
    top: Math.round(top),
    right: Math.round(right),
    bottom: Math.round(bottom),
    left: Math.round(left)
  };
}

function cssPx(styles: CSSStyleDeclaration, name: string, fallback = 0): number {
  const value = Number.parseFloat(styles.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

/** Reads the insets the shell publishes as custom properties on `<html>`. */
export function readChromeInsets(): ChromeInsets {
  const styles = getComputedStyle(document.documentElement);
  const footer = document.querySelector<HTMLElement>(".map-footer-stack");
  return {
    topBarBottom: cssPx(styles, "--chrome-top", 60),
    sidebarWidth: cssPx(styles, "--sidebar-w-open"),
    drawerWidth: cssPx(styles, "--drawer-w-open"),
    sheetHeight: cssPx(styles, "--sheet-h"),
    bottomNavHeight: cssPx(styles, "--bottom-nav-h"),
    footerHeight: footer ? Math.round(footer.getBoundingClientRect().height) : 0
  };
}
