/** Material Design–style 24×24 path data (filled) for pin glyphs.
 * Paths are drawn into the pin canvas — no webfont / extra package needed.
 * The glyph registry drives both the pin badge (pinIcons) and live vehicle silhouettes
 * (liveTraffic), so a new category only needs one path entry here (§U). */
export const MATERIAL_ICON_PATHS: Record<string, string> = {
  flight:
    "M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z",
  directions_boat: "M12 2L7 7v12l5 3 5-3V7zM10 9h4v8h-4z",
  account_balance:
    "M4 10v8h3v-8H4zm10 0v8h3v-8h-3zM2 19h20v3H2v-3zm14-12.14L12 6.5 8 6.86V10h8V6.86zM12 1L2 6.5V9h20V6.5L12 1z",
  atm: "M11 17h2v-1h1c.55 0 1-.45 1-1v-3c0-.55-.45-1-1-1h-3v-1h4V8h-2V7h-2v1h-1c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1h3v1H9v2h2v1zm8-3V6c0-1.1-.9-2-2-2H7c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-4h2.5V11H19zM17 20H7V6h10v14z",
  lighthouse:
    "M12 1L8 5h1l-1 3h8l-1-3h1L12 1zm-3.9 7L7 20H5v2h14v-2h-2l-1.1-12H8.1zM12 10c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm0 6c-.83 0-1.5.67-1.5 1.5S11.17 19 12 19s1.5-.67 1.5-1.5S12.83 16 12 16z",
  webcam:
    "M20 4H7v3H5c-1.1 0-2 .9-2 2v9c0 1.1.9 2 2 2h9c1.1 0 2-.9 2-2v-3h1c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM9.5 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5zm8-1V12h1v2.5h-1z",
  satellite:
    "M19 3l-1.01 3.87L14.14 7.87 12 5.73 13.74 4c.61-.47 1.23-.87 1.88-1.26C16.97 2.6 18.47 2.66 19.01 3M5.64 20.36c.26.26.68.26.94 0l9.5-9.5c.26-.26.26-.68 0-.94l-.94-.94c-.26-.26-.68-.26-.94 0l-9.5 9.5c-.26.26-.26.68 0 .94l.94.94zM4.05 13.95l-2 2c-.26.26-.26.68 0 .94l1 1c.26.26.68.26.94 0l2-2M14.95 4.05l2-2c.26-.26.68-.26.94 0l1 1c.26.26.26.68 0 .94l-2 2M10.03 9.03l6 6c.26.26.26.68 0 .94l-1.5 1.5c-.26.26-.68.26-.94 0l-6-6c-.26-.26-.26-.68 0-.94l1.5-1.5c.26-.26.68-.26.94 0z",
  note: "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 10H8v-2h2v2zm4-4H8V7h6v2z",
  restaurant:
    "M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z",
  cafe: "M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z",
  bar: "M21 5V3H3v2l8 9v5H6v2h12v-2h-5v-5l8-9zM7.43 7L5.66 5h12.69l-1.78 2H7.43z",
  brewery:
    "M6 3v6c0 2.97 2.16 5.43 5 5.91V19H8v2h8v-2h-3v-4.09c2.84-.48 5-2.94 5-5.91V3H6zm10 2v1H8V5h8z",
  parking:
    "M13 3H6v18h4v-6h3c3.31 0 6-2.69 6-6s-2.69-6-6-6zm.2 8H10V7h3.2c1.1 0 2 .9 2 2s-.9 2-2 2z",
  fuel: "M19.77 7.23l.01-.01-3.72-3.72L15 4.56l2.11 2.11c-.94.36-1.61 1.26-1.61 2.33 0 1.38 1.12 2.5 2.5 2.5.35 0 .69-.07 1-.18v7.18c0 .55-.45 1-1 1s-1-.45-1-1V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v16h10v-7.5h1.5v5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V9c0-.69-.28-1.32-.73-1.77zM12 10H6V5h6v5zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z",
  charging:
    "M14.94 4.66L12.45 2 10 4.66l1.01 1.01L8.5 12h5.99l-2.55 7.35L14.5 22l5-7.5H14.5l2.45-7.83zM7 20h4v2H7z",
  air: "M10.5 6.5a2.5 2.5 0 0 1 5 .5h1a3.5 3.5 0 1 0-7 0h1a2.5 2.5 0 0 1 2.5-2.5zm3 5a3 3 0 0 1 6 0h1a4 4 0 1 0-8 0h1a3 3 0 0 1 3-3zM7.5 11a2.5 2.5 0 0 1 5 0h1a3.5 3.5 0 1 0-7 0h1a2.5 2.5 0 0 1 2.5-2.5z",
  leaf: "M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75C7 8 17 8 17 8z",
  event:
    "M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z",
  drinking_water:
    "M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8zm0 18c-3.35 0-6-2.57-6-6.2 0-2.34 1.95-5.44 6-9.14 4.05 3.7 6 6.79 6 9.14 0 3.63-2.65 6.2-6 6.2z",
  toilets:
    "M5.5 22v-7.5H4V9c0-1.1.9-2 2-2h3c1.1 0 2 .9 2 2v5.5H9.5V22h-4zM15 22v-6h3l-2.54-7.63A2.01 2.01 0 0 0 13.55 7H12.5c-.8 0-1.54.5-1.85 1.26L8 16h3v6h4z",
  shower:
    "M8.5 21H5V10.5C5 8.01 7.01 6 9.5 6H11V3h2v3h1.5c2.49 0 4.5 2.01 4.5 4.5V21h-3.5v-7h-5v7z",
  viewpoint:
    "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
  waterfall:
    "M6 3v6c0 2.97 2.16 5.43 5 5.91V21h2v-6.09c2.84-.48 5-2.94 5-5.91V3H6zm10 2v4c0 2.21-1.79 4-4 4s-4-1.79-4-4V5h8z",
  lake: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z",
  peak: "M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z",
  cave: "M12 3C7.03 3 3 7.03 3 12v8h18v-8c0-4.97-4.03-9-9-9zm7 14H5v-5c0-3.87 3.13-7 7-7s7 3.13 7 7v5z",
  castle: "M12 2L9 5v3H5v3H2v11h7v-5h6v5h7V11h-3V8h-4V5l-3-3zm-1 16H9v-3h2v3zm4 0h-2v-3h2v3z",
  palace: "M6.5 10h11v2h-11zm0 4h11v2h-11zM4 22h16V8l-8-6-8 6v14zm2-12h12v10H6V10z",
  ruins: "M4 22h16V10l-4-4-4 3-4-3-4 4v12zm4-8h2v4H8v-4zm6 0h2v4h-2v-4z",
  museum: "M22 11V9L12 2 2 9v2h2v9H2v2h20v-2h-2v-9h2zm-6 9h-2v-6h-4v6H8v-8h8v8z",
  monument: "M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6z",
  camp_site: "M12 3L4 21h16L12 3zm0 4.6L16.9 19H7.1L12 7.6z",
  alpine_hut: "M10 20v-6h4v6h5V10L12 3 5 10v10h5z",
  shelter: "M12 3L2 12h3v8h6v-6h2v6h6v-8h3L12 3z",
  "user-pin":
    "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z",
  "p4n-camping":
    "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z",
  "p4n-parking":
    "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z",
  "p4n-aire":
    "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z",
  "p4n-other": "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z",
  earthquake: "M2 11h5l2-7 4 16 3-9h6v2h-4l-5 11L9 11l-1 2H2z",
  fire: "M13 2c1 6-5 7-3 11-2-1-3-3-3-5-6 7-2 14 5 14 8 0 12-10 1-20zm-1 18c-4 0-4-4-1-7 0 3 4 3 3 5 0 1-1 2-2 2z",
  message:
    "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 6h12v2H6zm0 4h12v2H6zm0 4h8v2H6z",
  sign: "M12 2 2 12l10 10 10-10L12 2zm1 5v6h-2V7h2zm0 8v2h-2v-2h2z",
  health: "M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z",
  school: "M12 3 1 9l11 6 9-5v7h2V9L12 3zM5 13v5l7 4 7-4v-5l-7 4z",
  sport: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-3 8 3-2 3 2-1 4h-4z",
  bicycle:
    "M5 12a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm14-2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM9 3h4v2h-1l5 8-2 1-3-5-4 7-2-1 5-9-1-1H9z",
  default: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
};

/** Draws a Material glyph path into a ctx at centre (x,y), scaled so the 24×24 path fits the
 *  given diameter. Shared by the pin badge (pinIcons) and the live vehicle silhouette
 *  (liveTraffic) so both render the same shape from the same registry. */
export function drawGlyphIntoContext(
  ctx: CanvasRenderingContext2D,
  pathData: string,
  x: number,
  y: number,
  diameter: number
) {
  const shape = new Path2D(pathData);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(diameter / 24, diameter / 24);
  ctx.translate(-12, -12);
  ctx.fill(shape);
  ctx.restore();
}

export function glyphPath(categoryId: string): string {
  if (categoryId === "weed-dispensary" || categoryId === "weed-both")
    return MATERIAL_ICON_PATHS.health!;
  if (categoryId === "weed-shop" || categoryId === "weed-unknown") return MATERIAL_ICON_PATHS.leaf!;
  return MATERIAL_ICON_PATHS[categoryId] ?? MATERIAL_ICON_PATHS.default!;
}
