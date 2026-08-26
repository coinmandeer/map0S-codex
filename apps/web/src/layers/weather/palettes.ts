/** Colour ramps for the weather overlays.
 *
 *  OpenWeatherMap's raster tiles arrive pre-coloured in pale, low-contrast palettes that vanish
 *  over a map. Because the overlays now draw from numeric grids, the colours are ours to choose —
 *  these ramps follow the saturated, high-contrast look that makes Windy readable at a glance.
 */

export type Rgba = [number, number, number, number];

export interface RampStop {
  value: number;
  color: Rgba;
}

export interface Palette {
  stops: RampStop[];
  /** Fixed scale for the legend; overlays use it so colours mean the same thing everywhere,
   *  instead of restretching to whatever happens to be in the viewport. */
  domain: [number, number];
  /** Ticks worth labelling on the legend. */
  ticks: number[];
}

const rgba = (r: number, g: number, b: number, a = 1): Rgba => [r, g, b, a];

export const PALETTES: Record<string, Palette> = {
  temperature: {
    domain: [-30, 45],
    ticks: [-20, -10, 0, 10, 20, 30, 40],
    stops: [
      { value: -30, color: rgba(90, 20, 130) },
      { value: -20, color: rgba(40, 60, 190) },
      { value: -10, color: rgba(30, 130, 220) },
      { value: -0.01, color: rgba(120, 205, 235) },
      { value: 0, color: rgba(215, 240, 235) },
      { value: 10, color: rgba(120, 200, 110) },
      { value: 18, color: rgba(240, 220, 90) },
      { value: 26, color: rgba(245, 150, 50) },
      { value: 34, color: rgba(225, 55, 45) },
      { value: 45, color: rgba(130, 15, 60) }
    ]
  },
  precipitation: {
    domain: [0, 20],
    ticks: [0.2, 1, 3, 8, 15],
    stops: [
      { value: 0, color: rgba(120, 190, 255, 0) },
      { value: 0.15, color: rgba(120, 190, 255, 0.35) },
      { value: 1, color: rgba(60, 150, 245, 0.75) },
      { value: 3, color: rgba(40, 200, 160, 0.85) },
      { value: 6, color: rgba(245, 220, 70, 0.9) },
      { value: 10, color: rgba(245, 130, 45, 0.95) },
      { value: 20, color: rgba(215, 40, 90, 1) }
    ]
  },
  wind: {
    domain: [0, 35],
    ticks: [2, 6, 12, 20, 30],
    stops: [
      { value: 0, color: rgba(35, 90, 130, 0.5) },
      { value: 3, color: rgba(40, 150, 175, 0.65) },
      { value: 7, color: rgba(70, 200, 150, 0.75) },
      { value: 12, color: rgba(215, 225, 90, 0.8) },
      { value: 18, color: rgba(245, 155, 55, 0.85) },
      { value: 25, color: rgba(230, 60, 60, 0.9) },
      { value: 35, color: rgba(150, 30, 140, 0.95) }
    ]
  },
  gusts: {
    domain: [0, 45],
    ticks: [5, 12, 20, 30, 40],
    stops: [
      { value: 0, color: rgba(35, 90, 130, 0.45) },
      { value: 8, color: rgba(60, 180, 175, 0.7) },
      { value: 16, color: rgba(220, 220, 90, 0.8) },
      { value: 25, color: rgba(245, 140, 50, 0.88) },
      { value: 34, color: rgba(230, 55, 60, 0.92) },
      { value: 45, color: rgba(150, 25, 140, 0.95) }
    ]
  },
  clouds: {
    domain: [0, 100],
    ticks: [20, 40, 60, 80, 100],
    stops: [
      { value: 0, color: rgba(255, 255, 255, 0) },
      { value: 25, color: rgba(235, 240, 248, 0.25) },
      { value: 55, color: rgba(215, 225, 240, 0.5) },
      { value: 80, color: rgba(180, 195, 215, 0.7) },
      { value: 100, color: rgba(140, 158, 185, 0.85) }
    ]
  },
  pressure: {
    domain: [960, 1050],
    ticks: [970, 990, 1013, 1030, 1045],
    stops: [
      { value: 960, color: rgba(80, 30, 140, 0.8) },
      { value: 985, color: rgba(50, 110, 210, 0.7) },
      { value: 1005, color: rgba(110, 200, 190, 0.55) },
      { value: 1013, color: rgba(240, 240, 225, 0.45) },
      { value: 1025, color: rgba(245, 180, 70, 0.6) },
      { value: 1050, color: rgba(215, 60, 50, 0.8) }
    ]
  },
  humidity: {
    domain: [0, 100],
    ticks: [20, 40, 60, 80, 100],
    stops: [
      { value: 0, color: rgba(220, 170, 90, 0.45) },
      { value: 35, color: rgba(230, 225, 150, 0.45) },
      { value: 60, color: rgba(120, 200, 175, 0.55) },
      { value: 85, color: rgba(45, 140, 210, 0.7) },
      { value: 100, color: rgba(25, 70, 170, 0.85) }
    ]
  }
};

export function paletteFor(variable: string): Palette {
  return PALETTES[variable] ?? PALETTES.temperature!;
}

/** Linear interpolation between the two surrounding stops, in straight (non-premultiplied) RGBA. */
export function sampleRamp(palette: Palette, value: number): Rgba {
  const { stops } = palette;
  if (value <= stops[0]!.value) return stops[0]!.color;
  const last = stops[stops.length - 1]!;
  if (value >= last.value) return last.color;

  for (let i = 1; i < stops.length; i += 1) {
    const upper = stops[i]!;
    if (value > upper.value) continue;
    const lower = stops[i - 1]!;
    const span = upper.value - lower.value || 1;
    const t = (value - lower.value) / span;
    return [
      Math.round(lower.color[0] + (upper.color[0] - lower.color[0]) * t),
      Math.round(lower.color[1] + (upper.color[1] - lower.color[1]) * t),
      Math.round(lower.color[2] + (upper.color[2] - lower.color[2]) * t),
      lower.color[3] + (upper.color[3] - lower.color[3]) * t
    ];
  }
  return last.color;
}

export function rampCssGradient(palette: Palette): string {
  const [min, max] = palette.domain;
  const span = max - min || 1;
  const steps = palette.stops.map((stop) => {
    const [r, g, b, a] = stop.color;
    const pct = ((stop.value - min) / span) * 100;
    return `rgba(${r}, ${g}, ${b}, ${a}) ${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${steps.join(", ")})`;
}
