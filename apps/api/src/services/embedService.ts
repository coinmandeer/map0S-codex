/** Decides whether a URL can be shown in an iframe.
 *
 *  This cannot be answered from the browser. A page that refuses framing does so through
 *  response headers the parent document is not allowed to read, and the load event fires either
 *  way — so the frame just sits there blank with no way to detect it. The server can read those
 *  headers, so it answers on the client's behalf and the panel degrades to a link before it ever
 *  renders an empty box.
 */

import { config } from "../config.js";

export type EmbedVerdict = "allowed" | "blocked" | "unknown";

export interface EmbedProbe {
  url: string;
  verdict: EmbedVerdict;
  /** Which header decided it, for debugging a surprising verdict. */
  reason: string;
}

/**
 * Hosts whose behaviour is known and stable, so a probe is a waste of a round trip.
 *
 * Verified by measurement rather than documentation — several of these advertise embed URLs
 * while still sending `X-Frame-Options` on them.
 */
const KNOWN: Array<{ pattern: RegExp; verdict: EmbedVerdict; reason: string }> = [
  { pattern: /(^|\.)m\.wikipedia\.org$/, verdict: "allowed", reason: "known-good" },
  { pattern: /(^|\.)wikipedia\.org$/, verdict: "allowed", reason: "known-good" },
  { pattern: /(^|\.)openstreetmap\.org$/, verdict: "allowed", reason: "known-good" },
  { pattern: /(^|\.)mapillary\.com$/, verdict: "allowed", reason: "known-good" },
  { pattern: /(^|\.)windy\.com$/, verdict: "allowed", reason: "known-good" },
  { pattern: /(^|\.)opentopomap\.org$/, verdict: "allowed", reason: "known-good" },
  { pattern: /(^|\.)youtube(-nocookie)?\.com$/, verdict: "allowed", reason: "known-good" },
  { pattern: /(^|\.)google\.[a-z.]+$/, verdict: "blocked", reason: "known-bad" },
  { pattern: /(^|\.)foursquare\.com$/, verdict: "blocked", reason: "known-bad" },
  { pattern: /(^|\.)komoot\.(com|de)$/, verdict: "blocked", reason: "known-bad" },
  { pattern: /(^|\.)thecrag\.com$/, verdict: "blocked", reason: "known-bad" },
  { pattern: /(^|\.)geocaching\.com$/, verdict: "blocked", reason: "known-bad" },
  { pattern: /(^|\.)park4night\.com$/, verdict: "blocked", reason: "known-bad" }
];

const cache = new Map<string, { probe: EmbedProbe; expiresAt: number }>();
const TTL_MS = 24 * 3600_000;
const MAX_ENTRIES = 500;

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

async function probe(url: string): Promise<EmbedProbe> {
  let res: Response;
  try {
    // HEAD first: most servers answer it, and it avoids pulling a whole page just to read two
    // headers. GET is the fallback for the ones that reject HEAD outright.
    res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": config.userAgent },
      signal: AbortSignal.timeout(8000)
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": config.userAgent },
        signal: AbortSignal.timeout(8000)
      });
    }
  } catch {
    return { url, verdict: "unknown", reason: "probe failed" };
  }

  const xfo = res.headers.get("x-frame-options")?.toLowerCase().trim();
  if (xfo === "deny" || xfo === "sameorigin" || xfo?.startsWith("allow-from")) {
    return { url, verdict: "blocked", reason: `x-frame-options: ${xfo}` };
  }

  const csp = readCsp(res.headers.get("content-security-policy"));
  if (csp) return { url, verdict: csp, reason: "csp frame-ancestors" };

  return { url, verdict: "allowed", reason: "no framing restriction" };
}

export async function checkEmbeddable(rawUrl: string): Promise<EmbedProbe> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { url: rawUrl, verdict: "blocked", reason: "invalid url" };
  }
  // Anything framed runs in the user's browser; plain HTTP inside an HTTPS page would be blocked
  // as mixed content anyway.
  if (parsed.protocol !== "https:") {
    return { url: rawUrl, verdict: "blocked", reason: "not https" };
  }

  const known = KNOWN.find((entry) => entry.pattern.test(parsed.hostname));
  if (known) return { url: rawUrl, verdict: known.verdict, reason: known.reason };

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
  return [
    "https://*.wikipedia.org",
    "https://www.openstreetmap.org",
    "https://*.mapillary.com",
    "https://embed.windy.com",
    "https://opentopomap.org",
    "https://www.youtube-nocookie.com"
  ];
}

export function __resetEmbedCache() {
  cache.clear();
}
