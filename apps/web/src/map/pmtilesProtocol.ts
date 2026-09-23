import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

/**
 * Teaches MapLibre the `pmtiles://` URLs that `pmtilesAdapter` produces.
 *
 * A PMTiles archive is a single file read with `Range` requests, so a tile is a byte range
 * rather than a URL. MapLibre has no notion of that, but it does let a scheme be handled, and
 * the `pmtiles` library's `Protocol` is exactly that handler: it reads the archive's header and
 * directories once, caches them, and answers each `{z}/{x}/{y}` from the right range.
 *
 * Registered globally and once, because the protocol is a property of the URL scheme rather than
 * of a map instance, and registering twice replaces the handler along with its warm directory
 * cache — which would re-read the header of every archive on screen.
 */
let protocol: Protocol | null = null;

export function registerPmTilesProtocol(): void {
  if (protocol) return;
  // `metadata: false`: the protocol can read the archive's metadata block to populate
  // attribution, but that is an extra request per archive and `pmtilesAdapter.probe` already
  // put the attribution in the manifest.
  protocol = new Protocol({ metadata: false });
  maplibregl.addProtocol("pmtiles", protocol.tile);
}
