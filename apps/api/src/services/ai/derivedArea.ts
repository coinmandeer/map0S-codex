import type { MapResultDraft } from "@mapos/layer-sdk";
type Point = [number, number];
/** Spherical distance buffer, split at the date line. This is not a travel-time isochrone. */
export function deriveRadiusArea(
  longitude: number,
  latitude: number,
  radiusKm: number
): MapResultDraft {
  if (
    ![longitude, latitude, radiusKm].every(Number.isFinite) ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 85 ||
    radiusKm < 0.1 ||
    radiusKm > 500
  )
    throw new Error("Neplatný rozsah odvozené oblasti");
  const radians = Math.PI / 180,
    distance = radiusKm / 6371.0088,
    lat = latitude * radians;
  if (Math.abs(lat) + distance >= Math.PI / 2)
    throw new Error("Oblast přes pól není tímto nástrojem podporovaná");
  const ring: Point[] = Array.from({ length: 96 }, (_, i) => {
    const bearing = (2 * Math.PI * i) / 96;
    const phi = Math.asin(
      Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing)
    );
    const delta = Math.atan2(
      Math.sin(bearing) * Math.sin(distance) * Math.cos(lat),
      Math.cos(distance) - Math.sin(lat) * Math.sin(phi)
    );
    return [longitude + delta / radians, phi / radians];
  });
  const clip = (input: Point[], boundary: number, keepEast: boolean): Point[] => {
    const result: Point[] = [];
    const inside = (p: Point) => (keepEast ? p[0] >= boundary : p[0] <= boundary);
    for (let i = 0; i < input.length; i++) {
      const a = input[i]!,
        b = input[(i + 1) % input.length]!;
      if (inside(a)) result.push(a);
      if (inside(a) !== inside(b))
        result.push([boundary, a[1] + ((b[1] - a[1]) * (boundary - a[0])) / (b[0] - a[0])]);
    }
    return result;
  };
  const polygons = [-360, 0, 360].flatMap((offset) => {
    const part = clip(clip(ring, -180 + offset, true), 180 + offset, false);
    if (part.length < 3) return [];
    const shifted = part.map(([x, y]): Point => [x - offset, y]);
    shifted.push([...shifted[0]!]);
    return [[shifted]];
  });
  const title = `Okruh ${radiusKm} km`;
  return {
    id: `radius-${longitude.toFixed(5)}-${latitude.toFixed(5)}-${radiusKm}`,
    title,
    style: { palette: "blue", opacity: 0.65 },
    sources: [{ id: "mapos-geometry", label: "mapOS · geodetický výpočet na referenční kouli" }],
    derived: {
      method: "geodesic-buffer",
      description: `Vzdušná vzdálenost ${radiusKm} km od zvoleného středu; nejde o dostupnost po cestách.`
    },
    data: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "radius",
          properties: { title, sourceId: "mapos-geometry" },
          geometry:
            polygons.length === 1
              ? { type: "Polygon", coordinates: polygons[0]! }
              : { type: "MultiPolygon", coordinates: polygons }
        }
      ]
    }
  };
}
