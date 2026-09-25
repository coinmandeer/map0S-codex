import { randomUUID } from "node:crypto";
import {
  createBuiltInAdapterRegistry,
  SourceProbeError,
  type AdapterIo,
  type SourceProbe
} from "@mapos/adapter-sdk";
import type { LayerCategoryV2, LayerManifestV2 } from "@mapos/layer-sdk";
import { validateLayerManifestV2 } from "@mapos/layer-sdk";
import { fetchJson, fetchRange, fetchText, UpstreamError } from "../utils/upstream.js";

/**
 * The "add source from URL" wizard's server half.
 *
 * The probe happens here and not in the browser for three reasons, all of which the adapters
 * depend on: the URL comes from a user, so it has to go through `upstream.ts` — DNS pinning,
 * timeouts, size caps, the circuit breaker, the offline guard; a public service usually sends no
 * CORS headers, so the browser could not read its capabilities at all; and the probe result is
 * cached per URL, so several users pasting the same well-known WMS cost one GetCapabilities
 * between them rather than one each.
 *
 * What crosses back to the client is a `SourceProbe`, which is serialisable on purpose: the user
 * picks sublayers from it and asks for a manifest without anything going back to the service.
 */

/** One provider id for everything pasted, because `upstream.ts` uses it for the circuit breaker
 *  and rate limiting, and it forbids user-controlled values there. The consequence is that all
 *  pasted URLs share one breaker, which is the conservative direction: one hostile or broken
 *  host cannot be told apart from another, so a run of failures slows all of them down. */
const PROVIDER_ID = "user-source";

/** Generous enough for a real capabilities document — some national services publish thousands
 *  of layers — and far below the 16 MiB hard cap. */
const MAX_PROBE_BYTES = 8 * 1024 * 1024;

/** A capabilities document does not change between two people pasting the same URL a minute
 *  apart, and re-probing on every keystroke of a corrected URL is what would make this feel
 *  slow. */
const PROBE_TTL_MS = 10 * 60_000;

const XML_CONTENT_TYPES = [
  "text/xml",
  "application/xml",
  "application/vnd.ogc.wms_xml",
  "application/vnd.ogc.se_xml",
  "text/plain"
] as const;

export const sourceAdapters = createBuiltInAdapterRegistry();

/** The adapters' network, wired to the guarded client. Nothing here is reachable from an
 *  adapter except through this object. */
export const upstreamAdapterIo: AdapterIo = {
  async text(url, options) {
    return fetchText(url, {
      providerId: PROVIDER_ID,
      acceptedContentTypes: XML_CONTENT_TYPES,
      maxResponseBytes: MAX_PROBE_BYTES,
      ttlMs: PROBE_TTL_MS,
      ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {})
    });
  },
  async json(url, options) {
    return fetchJson<unknown>(url, {
      providerId: PROVIDER_ID,
      maxResponseBytes: MAX_PROBE_BYTES,
      ttlMs: PROBE_TTL_MS,
      ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.signal ? { signal: options.signal } : {})
    });
  },
  async head(url, byteLength, offset = 0) {
    return fetchRange(url, {
      providerId: PROVIDER_ID,
      offset,
      length: byteLength,
      ttlMs: PROBE_TTL_MS
    });
  }
};

export interface SourceProbeResult {
  probe: SourceProbe;
  /** Which adapters recognised the URL, so the wizard can say what it thinks this is before the
   *  probe returns and can offer the runner-up if the user disagrees. */
  candidates: Array<{ adapterId: string; label: string; confidence: number }>;
}

export class SourceRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "SourceRequestError";
  }
}

export function detectSourceCandidates(url: string): SourceProbeResult["candidates"] {
  return sourceAdapters.detect(url).map(({ adapter, confidence }) => ({
    adapterId: adapter.id,
    label: adapter.label,
    confidence
  }));
}

export async function probeSource(
  rawUrl: string,
  io: AdapterIo = upstreamAdapterIo
): Promise<SourceProbeResult> {
  const url = cleanUrl(rawUrl);
  const candidates = detectSourceCandidates(url);
  if (!candidates.length) {
    throw new SourceRequestError(
      "Tuhle adresu neumíme rozpoznat. Podporujeme WMS, WMTS, ArcGIS REST a PMTiles.",
      422
    );
  }
  try {
    const probe = await sourceAdapters.probe(url, io);
    return { probe, candidates };
  } catch (error) {
    // A service that refused, timed out or answered nonsense is the user's problem to fix, and
    // they can only fix it if told which it was — so the upstream's own words come through
    // rather than a generic failure.
    if (error instanceof SourceProbeError) throw new SourceRequestError(error.message, 422);
    if (error instanceof UpstreamError) throw new SourceRequestError(error.message, 502);
    throw error;
  }
}

export interface DescribeSourceInput {
  probe: SourceProbe;
  sublayerIds: string[];
  name?: string;
  category?: LayerCategoryV2;
  /** Minted here rather than by the client, so a client cannot choose an id that collides with
   *  a built-in layer. */
  layerId?: string;
}

export function describeSource(input: DescribeSourceInput): LayerManifestV2 {
  const adapter = sourceAdapters.get(input.probe.adapterId);
  if (!adapter) {
    throw new SourceRequestError("Tenhle typ zdroje už neumíme zpracovat.", 422);
  }
  const unknown = input.sublayerIds.filter(
    (id) => !input.probe.sublayers.some((sublayer) => sublayer.id === id)
  );
  if (unknown.length) {
    throw new SourceRequestError(`Zdroj nezná vrstvu ${unknown[0]}.`, 422);
  }

  let manifest: LayerManifestV2;
  try {
    manifest = adapter.describe({
      probe: input.probe,
      sublayerIds: input.sublayerIds,
      layerId: input.layerId ?? `src-${randomUUID()}`,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      ...(input.category ? { category: input.category } : {})
    });
  } catch (error) {
    if (error instanceof SourceProbeError) throw new SourceRequestError(error.message, 422);
    throw error;
  }

  // The manifest is about to be stored and later rendered, so it is validated here rather than
  // trusted: a probe travelled through the client to get here and could have been edited.
  const report = validateLayerManifestV2(manifest);
  if (!report.valid) {
    throw new SourceRequestError(
      report.issues[0]?.message ?? "Z tohohle zdroje neumíme udělat platnou vrstvu.",
      422
    );
  }
  return manifest;
}

/** Rejects what `validateUpstreamUrl` would reject anyway, but with a message about the address
 *  the user typed rather than about an upstream. */
function cleanUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new SourceRequestError("Zadej adresu zdroje.", 400);
  if (trimmed.length > 2048) throw new SourceRequestError("Adresa je příliš dlouhá.", 400);
  let parsed: URL;
  try {
    // `pmtiles://https://…` is MapLibre's scheme wrapping a real URL, and people copy it out of
    // styles, so it is unwrapped rather than refused.
    parsed = new URL(trimmed.replace(/^pmtiles:\/\//i, ""));
  } catch {
    throw new SourceRequestError("Tohle není platná adresa.", 400);
  }
  if (parsed.protocol !== "https:") {
    throw new SourceRequestError("Podporujeme jen adresy https://.", 400);
  }
  return parsed.href;
}
