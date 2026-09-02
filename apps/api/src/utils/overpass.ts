import { fetchJson } from "./upstream.js";

// overpass-api.de is not reachable over IPv4 from the production VPS. Keep the
// reachable community mirrors first and treat every endpoint as replaceable.
export const OVERPASS_URLS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter"
] as const;

const OVERPASS_PROVIDER_IDS = ["overpass-fr", "overpass-kumi", "overpass-de"] as const;

export async function fetchOverpass<T = unknown>(
  query: string,
  options: { timeoutMs?: number } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const startedAt = Date.now();
  let lastError: unknown = null;

  for (let index = 0; index < OVERPASS_URLS.length; index += 1) {
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining < 300) break;
    const remainingEndpoints = OVERPASS_URLS.length - index;
    const attemptMs = Math.max(250, Math.min(4_000, Math.floor(remaining / remainingEndpoints)));
    try {
      return await fetchJson<T>(OVERPASS_URLS[index]!, {
        providerId: OVERPASS_PROVIDER_IDS[index]!,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ data: query }).toString(),
        ttlMs: 0,
        timeoutMs: attemptMs,
        maxResponseBytes: 8 * 1024 * 1024
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Overpass není dostupný");
}
