/** Take only provider rectangles containing the current centre; unrelated rectangles do not
 * restrict the whole world. Invalid metadata never expands the renderer's own maximum. */
export function googleMaximumZoom(
  rectangles: unknown,
  lng: number,
  lat: number,
  fallback: number
): number {
  if (!Array.isArray(rectangles)) return fallback;
  const values: number[] = [];
  for (const rectangle of rectangles) {
    if (!rectangle || typeof rectangle !== "object") continue;
    const r = rectangle as Record<string, unknown>;
    if (
      !["north", "south", "east", "west", "maxZoom"].every(
        (k) => typeof r[k] === "number" && Number.isFinite(r[k])
      )
    )
      continue;
    const { north, south, east, west, maxZoom } = r as Record<string, number>;
    if (
      north! < south! ||
      north! > 90 ||
      south! < -90 ||
      Math.abs(east!) > 180 ||
      Math.abs(west!) > 180 ||
      maxZoom! < 0 ||
      maxZoom! > 22
    )
      continue;
    const insideLng = west! <= east! ? lng >= west! && lng <= east! : lng >= west! || lng <= east!;
    if (insideLng && lat >= south! && lat <= north!) values.push(maxZoom!);
  }
  return values.length ? Math.min(fallback, ...values) : fallback;
}
