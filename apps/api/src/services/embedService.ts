/** Decides whether a URL can be shown in an iframe.
 *
 *  This cannot be answered from the browser. A page that refuses framing does so through
 *  response headers the parent document is not allowed to read, and the load event fires either
 *  way — so the frame just sits there blank with no way to detect it. The server can read those
 *  headers, so it answers on the client's behalf and the panel degrades to a link before it ever
 *  renders an empty box.
 */

import { isIP } from "node:net";
import { fetchMetadata, type UpstreamMetadata } from "../utils/upstream.js";

export type EmbedVerdict = "allowed" | "blocked" | "unknown";

export interface EmbedProbe {
  url: string;
  verdict: EmbedVerdict;
  /** Which header decided it, for debugging a surprising verdict. */
  reason: string;
}

/** Hosts the production CSP permits in frames. Keep this deliberately narrower than a general
 * web proxy: an arbitrary probe target would let callers make the API connect to internal
 * services. Wildcards have the same semantics as CSP wildcards and do not include the apex. */
const EMBED_HOSTS: Array<{ hostname: string; subdomains?: boolean; frameSrc: string }> = [
  { hostname: "wikipedia.org", subdomains: true, frameSrc: "https://*.wikipedia.org" },
  { hostname: "www.openstreetmap.org", frameSrc: "https://www.openstreetmap.org" },
  { hostname: "mapillary.com", subdomains: true, frameSrc: "https://*.mapillary.com" },
  { hostname: "embed.windy.com", frameSrc: "https://embed.windy.com" },
  { hostname: "opentopomap.org", frameSrc: "https://opentopomap.org" },
  { hostname: "www.youtube-nocookie.com", frameSrc: "https://www.youtube-nocookie.com" }
];

/**
 * Hosts whose behaviour is known and stable, so a probe is a waste of a round trip.
 *
 * Verified by measurement rather than documentation. YouTube is intentionally still probed so
 * the safe redirect path remains exercised for an allowlisted service whose behaviour can vary.
 */
const KNOWN_ALLOWED: RegExp[] = [
  /(^|\.)wikipedia\.org$/,
  /^www\.openstreetmap\.org$/,
  /(^|\.)mapillary\.com$/,
  /^embed\.windy\.com$/,
  /^opentopomap\.org$/
];

const cache = new Map<string, { probe: EmbedProbe; expiresAt: number }>();
const TTL_MS = 24 * 3600_000;
const MAX_ENTRIES = 500;
const MAX_REDIRECTS = 4;
const PROBE_TIMEOUT_MS = 8000;
const MAX_PROBE_RESPONSE_BYTES = 64 * 1024;

interface ValidUrl {
  ok: true;
  url: URL;
}

interface InvalidUrl {
  ok: false;
  reason: string;
}

type UrlValidation = ValidUrl | InvalidUrl;

function isAllowlistedHost(hostname: string): boolean {
  return EMBED_HOSTS.some(
    (entry) =>
      (entry.subdomains === true && hostname.endsWith(`.${entry.hostname}`)) ||
      (entry.subdomains !== true && hostname === entry.hostname)
  );
}

function validateUrl(rawUrl: string): UrlValidation {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid url" };
  }
  if (parsed.protocol !== "https:") return { ok: false, reason: "not https" };
  if (parsed.username || parsed.password) return { ok: false, reason: "credentials not allowed" };
  if (parsed.port && parsed.port !== "443") return { ok: false, reason: "port not allowed" };

  const hostname = parsed.hostname.toLowerCase();
  const bareHostname = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  if (
    bareHostname === "localhost" ||
    bareHostname.endsWith(".localhost") ||
    // No supported embed service uses an IP-literal URL. Rejecting every literal also covers
    // private, loopback, link-local, metadata and alternative IPv4 spellings after URL parsing.
    isIP(bareHostname) !== 0
  ) {
    return { ok: false, reason: "private or local address" };
  }
  if (!isAllowlistedHost(hostname)) return { ok: false, reason: "host not allowlisted" };
  return { ok: true, url: parsed };
}

function readCsp(header: string | null): EmbedVerdict | null {
  if (!header) return null;
  const directive = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith("frame-ancestors"));
  if (!directive) return null;
  const value = directive.slice("frame-ancestors".length).trim().toLowerCase();
  // 'none' and 'self' both exclude us; a wildcard or an explicit host list we're not on would
  // need the requesting origin to judge, and we don't have it here, so treat only * as open.
  if (value.includes("*")) return "allowed";
  return "blocked";
}

interface SafeFetchResult {
  response?: UpstreamMetadata;
  finalUrl?: string;
  blockedReason?: string;
}

async function fetchWithValidatedRedirects(
  initialUrl: string,
  method: "HEAD" | "GET",
  signal: AbortSignal
): Promise<SafeFetchResult> {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const validation = validateUrl(currentUrl);
    if (!validation.ok) return { blockedReason: validation.reason };

    const response = await fetchMetadata(validation.url.href, {
      providerId: "embed-probe",
      method,
      headers: {
        ...(method === "GET" ? { Range: "bytes=0-0" } : {})
      },
      signal,
      timeoutMs: PROBE_TIMEOUT_MS
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: validation.url.href };
    }

    const location = response.headers.get("location");
    if (!location) return { blockedReason: "redirect without location" };
    if (redirects === MAX_REDIRECTS) return { blockedReason: "too many redirects" };
    try {
      currentUrl = new URL(location, validation.url).href;
    } catch {
      return { blockedReason: "invalid redirect" };
    }
  }
  return { blockedReason: "too many redirects" };
}

async function probe(url: string): Promise<EmbedProbe> {
  let res: UpstreamMetadata | undefined;
  try {
    // One deadline covers HEAD, every redirect and the GET fallback, so a redirect chain cannot
    // multiply the timeout. GET asks for one byte; the shared transport cancels its body before
    // returning the response metadata.
    const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
    const head = await fetchWithValidatedRedirects(url, "HEAD", signal);
    if (head.blockedReason) {
      return { url, verdict: "blocked", reason: `redirect rejected: ${head.blockedReason}` };
    }
    res = head.response;
    if (!res) return { url, verdict: "unknown", reason: "probe failed" };

    if (res.status === 405 || res.status === 501) {
      const get = await fetchWithValidatedRedirects(head.finalUrl ?? url, "GET", signal);
      if (get.blockedReason) {
        return { url, verdict: "blocked", reason: `redirect rejected: ${get.blockedReason}` };
      }
      res = get.response;
      if (!res) return { url, verdict: "unknown", reason: "probe failed" };
      const contentLength = Number(res.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_PROBE_RESPONSE_BYTES) {
        return { url, verdict: "unknown", reason: "probe response too large" };
      }
    }
  } catch {
    return { url, verdict: "unknown", reason: "probe failed" };
  }

  if (res.status >= 400) {
    return { url, verdict: "unknown", reason: "probe returned an error status" };
  }

  const xfo = res.headers.get("x-frame-options")?.toLowerCase().trim();
  if (xfo === "deny" || xfo === "sameorigin" || xfo?.startsWith("allow-from")) {
    return { url, verdict: "blocked", reason: `x-frame-options: ${xfo}` };
  }

  const csp = readCsp(res.headers.get("content-security-policy"));
  if (csp) {
    return { url, verdict: csp, reason: "csp frame-ancestors" };
  }

  return { url, verdict: "allowed", reason: "no framing restriction" };
}

export async function checkEmbeddable(rawUrl: string): Promise<EmbedProbe> {
  const validation = validateUrl(rawUrl);
  if (!validation.ok) return { url: rawUrl, verdict: "blocked", reason: validation.reason };
  const parsed = validation.url;

  if (KNOWN_ALLOWED.some((pattern) => pattern.test(parsed.hostname))) {
    return { url: rawUrl, verdict: "allowed", reason: "known-good" };
  }

  const key = `${parsed.origin}${parsed.pathname}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return { ...hit.probe, url: rawUrl };

  const result = await probe(rawUrl);
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { probe: result, expiresAt: Date.now() + TTL_MS });
  return result;
}

/** Origins the browser is allowed to frame, as a CSP `frame-src` value. Derived from the same
 *  allowlist the probe uses, so the two can't drift apart. */
export function frameSrcAllowlist(): string[] {
  return EMBED_HOSTS.map((entry) => entry.frameSrc);
}

export function __resetEmbedCache() {
  cache.clear();
}
