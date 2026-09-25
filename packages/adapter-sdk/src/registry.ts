import type {
  AdapterIo,
  AdapterIoOptions,
  SourceAdapter,
  SourceKind,
  SourceProbe
} from "./contract.js";
import { SourceProbeError } from "./contract.js";

/** One adapter's opinion about a URL, above the noise floor. */
export interface SourceCandidate {
  adapter: SourceAdapter;
  confidence: number;
}

/** Below this a `detect` score is a guess, and offering a guess as a candidate wastes a probe
 *  and, worse, teaches the user that the detector is unreliable. */
export const DETECT_MIN_CONFIDENCE = 0.2;

export interface AdapterRegistry {
  register(adapter: SourceAdapter): void;
  get(id: string): SourceAdapter | undefined;
  list(): SourceAdapter[];
  forKind(kind: SourceKind): SourceAdapter[];
  /** Adapters that recognise this URL, most confident first. */
  detect(url: string | URL): SourceCandidate[];
  /**
   * Probes the best candidate, falling back to the next one when it turns out to be wrong.
   *
   * The fallback is the point: `?f=json` is an ArcGIS marker and also a perfectly ordinary query
   * string, so the ranking is a prediction. Trying the runner-up costs one request and is the
   * difference between "MapOS added your layer" and "MapOS said no to a working URL".
   */
  probe(url: string | URL, io: AdapterIo, options?: AdapterIoOptions): Promise<SourceProbe>;
}

export function createAdapterRegistry(initial: readonly SourceAdapter[] = []): AdapterRegistry {
  const adapters = new Map<string, SourceAdapter>();

  const registry: AdapterRegistry = {
    register(adapter) {
      if (adapters.has(adapter.id)) {
        throw new Error(`Source adapter "${adapter.id}" is already registered.`);
      }
      adapters.set(adapter.id, adapter);
    },
    get: (id) => adapters.get(id),
    list: () => [...adapters.values()],
    forKind: (kind) => [...adapters.values()].filter((adapter) => adapter.kinds.includes(kind)),
    detect: (url) => detectSource(url, [...adapters.values()]),
    async probe(url, io, options) {
      const target = asUrl(url);
      const candidates = registry.detect(target);
      if (!candidates.length) {
        throw new SourceProbeError("Tuhle adresu neumíme rozpoznat.", target.toString());
      }
      let lastError: unknown;
      for (const { adapter } of candidates) {
        try {
          return await adapter.probe(target, io, options);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new SourceProbeError("Zdroj neodpověděl použitelně.", target.toString());
    }
  };

  for (const adapter of initial) registry.register(adapter);
  return registry;
}

/**
 * Ranks adapters against a URL without touching the network.
 *
 * Ties are broken by registration order rather than by adapter id, so a deployment that
 * registers a specific adapter before a general one gets the specific one first — which is the
 * only way for a caller to express that preference from outside.
 */
export function detectSource(
  url: string | URL,
  adapters: readonly SourceAdapter[]
): SourceCandidate[] {
  let target: URL;
  try {
    target = asUrl(url);
  } catch {
    // An unparseable URL is not an error to report here: the wizard calls this while the user is
    // still typing, and half a URL is the normal state of that field.
    return [];
  }
  return adapters
    .map((adapter, order) => ({ adapter, order, confidence: score(adapter, target) }))
    .filter((candidate) => candidate.confidence >= DETECT_MIN_CONFIDENCE)
    .sort((left, right) => right.confidence - left.confidence || left.order - right.order)
    .map(({ adapter, confidence }) => ({ adapter, confidence }));
}

/** An adapter that throws while sniffing a URL must not take the whole wizard down with it, so
 *  a thrown `detect` reads as "not mine" rather than as a failure. */
function score(adapter: SourceAdapter, url: URL): number {
  try {
    const value = adapter.detect(url);
    return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
  } catch {
    return 0;
  }
}

function asUrl(url: string | URL): URL {
  return url instanceof URL ? url : new URL(url);
}

/** Case-insensitive query lookup. OGC services accept `REQUEST` and `request` alike, and a URL
 *  pasted out of a capabilities document usually shouts. */
export function queryParam(url: URL, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of url.searchParams) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

/** Strips the parameters that identify a request rather than a service, so two URLs pointing at
 *  the same endpoint normalise to the same string. */
export function serviceEndpoint(url: URL, drop: readonly string[]): string {
  const clean = new URL(url.toString());
  const removing = new Set(drop.map((name) => name.toLowerCase()));
  for (const key of [...clean.searchParams.keys()]) {
    if (removing.has(key.toLowerCase())) clean.searchParams.delete(key);
  }
  clean.hash = "";
  const query = clean.searchParams.toString();
  return `${clean.origin}${clean.pathname}${query ? `?${query}` : ""}`;
}
