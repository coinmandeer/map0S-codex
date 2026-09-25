/**
 * Layer colours are chosen for the map, where they sit on aerial imagery and terrain. In a panel
 * they land on a flat surface instead, and a colour that reads well over a satellite photo can be
 * a pale smudge on white — `#0ea5e9` is 2.77:1 there, below the 3:1 that WCAG asks of a graphic.
 *
 * So the colour is nudged towards the surface's opposite until it clears 3:1: darkened on light,
 * lightened on dark. The hue is left alone, so the row still reads as the same layer.
 */

/** The surfaces a tinted icon can sit on: `--surface-solid` in each theme. */
const SURFACE = { light: "#ffffff", dark: "#1a1d21" } as const;

const MIN_CONTRAST = 3;

export function readableLayerColor(color: string, theme: "light" | "dark"): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const surface = parseHex(SURFACE[theme])!;
  if (contrast(rgb, surface) >= MIN_CONTRAST) return color;

  // Walking the channels towards black or white keeps the hue and saturation ratio, and one of
  // the two ends always clears the threshold, so the loop cannot run out of room silently.
  const target = theme === "light" ? 0 : 255;
  for (let step = 1; step <= 20; step += 1) {
    const mixed = mix(rgb, target, step / 20);
    if (contrast(mixed, surface) >= MIN_CONTRAST) return toHex(mixed);
  }
  return theme === "light" ? "#000000" : "#ffffff";
}

type Rgb = readonly [number, number, number];

function parseHex(value: string): Rgb | null {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1]!;
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16)
  ];
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function mix(rgb: Rgb, target: number, amount: number): Rgb {
  return [
    rgb[0] + (target - rgb[0]) * amount,
    rgb[1] + (target - rgb[1]) * amount,
    rgb[2] + (target - rgb[2]) * amount
  ];
}

/** WCAG relative luminance. */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
