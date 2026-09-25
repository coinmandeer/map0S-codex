import type { Bbox, FeatureCollection, LayerManifestV2 } from "@mapos/layer-sdk";
import { arcgisAdapter, SourceProbeError, type AdapterIo } from "@mapos/adapter-sdk";
import { SourceRequestError, upstreamAdapterIo } from "./sourceService.js";
import { fetchJson } from "../utils/upstream.js";

// Capabilities are stable for minutes; viewport data may change between visits.
const featureAdapterIo: AdapterIo = {
  ...upstreamAdapterIo,
  json: (url, options) =>
    fetchJson(url, {
      providerId: "user-source-features",
      ttlMs: 30_000,
      maxResponseBytes: 4 * 1024 * 1024,
      timeoutMs: options?.timeoutMs ?? 15_000,
      signal: options?.signal
    })
};

/** Query only the stored, authorized source. The caller cannot substitute a URL or SQL clause.
 * Guarded IO owns DNS pinning, response size, provider rate limits and cache policy. */
export async function querySourceFeatures(
  manifest: LayerManifestV2,
  layerId: string,
  bbox: Bbox,
  signal?: AbortSignal,
  io: AdapterIo = featureAdapterIo
): Promise<FeatureCollection> {
  const source = manifest.source;
  if (source.type !== "server-adapter" || source.adapterId !== "arcgis" || !source.endpoint) {
    throw new SourceRequestError("Tento zdroj neposkytuje body ani linie.", 422);
  }
  let endpoint: URL;
  try {
    endpoint = new URL(source.endpoint);
  } catch {
    throw new SourceRequestError("Neplatná adresa uloženého zdroje.", 422);
  }
  const match = /\/FeatureServer\/(\d+)\/query\/?$/i.exec(endpoint.pathname);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    !match
  ) {
    throw new SourceRequestError("Neplatná adresa uloženého FeatureServeru.", 422);
  }
  endpoint.pathname = endpoint.pathname.replace(/\/\d+\/query\/?$/i, "");
  const id = match[1]!;
  try {
    signal?.throwIfAborted();
    const result = await arcgisAdapter.features!(
      {
        layerId,
        sublayerIds: [id],
        probe: {
          adapterId: "arcgis",
          kind: "arcgis-featureserver",
          delivery: "features",
          endpoint: endpoint.href,
          title: manifest.name,
          sublayers: [{ id, title: manifest.name, selectable: true }],
          extra: { geoJson: false }
        }
      },
      bbox,
      io,
      { signal, timeoutMs: 15000 }
    );
    signal?.throwIfAborted();
    return {
      ...result,
      query: { ...result.query, status: result.query?.status ?? "partial", cacheTtlMs: 30_000 }
    };
  } catch (error) {
    if (error instanceof SourceProbeError) throw new SourceRequestError(error.message, 502);
    throw error;
  }
}
