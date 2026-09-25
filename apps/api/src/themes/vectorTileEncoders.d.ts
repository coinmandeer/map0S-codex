/**
 * `geojson-vt` and `vt-pbf` ship no types. They are used only by the offline server, to encode
 * the same MVT that PostGIS produces in production, so the surface declared here is exactly the
 * two calls that path makes.
 */
declare module "geojson-vt" {
  interface TileIndexOptions {
    maxZoom?: number;
    extent?: number;
    buffer?: number;
    tolerance?: number;
    indexMaxZoom?: number;
    indexMaxPoints?: number;
    generateId?: boolean;
  }
  interface VtTile {
    features: unknown[];
  }
  interface TileIndex {
    getTile(z: number, x: number, y: number): VtTile | null;
  }
  export default function geojsonvt(data: unknown, options?: TileIndexOptions): TileIndex;
}

declare module "vt-pbf" {
  const vtpbf: {
    fromGeojsonVt(
      layers: Record<string, unknown>,
      options?: { version?: number; extent?: number }
    ): Uint8Array;
  };
  export default vtpbf;
}
