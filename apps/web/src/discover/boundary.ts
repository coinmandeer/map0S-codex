import type { Bbox } from "@mapos/layer-sdk";
import type { DiscoverContext } from "./context";

type BoundaryGeometry = NonNullable<DiscoverContext["boundary"]["geometry"]>;

/** Computes a safe map fit extent from provider geometry; a query bbox is never substituted. */
export function discoverBoundaryBbox(geometry: BoundaryGeometry): Bbox | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const visit = (value: unknown): void => {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1])
    ) {
      const lng = Number(value[0]);
      const lat = Number(value[1]);
      if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return;
      west = Math.min(west, lng);
      south = Math.min(south, lat);
      east = Math.max(east, lng);
      north = Math.max(north, lat);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  };
  visit(geometry.coordinates);
  return [west, south, east, north].every(Number.isFinite) && west < east && south < north
    ? [west, south, east, north]
    : null;
}
