import { isIP } from "node:net";

function privateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && parts[2] === 0) ||
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 192 && b === 88 && parts[2] === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

function mappedIpv4(address: string): string | null {
  const normalized = address.toLowerCase();
  if (!normalized.startsWith("::ffff:")) return null;
  const suffix = normalized.slice("::ffff:".length);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(suffix)) return suffix;
  const words = suffix.split(":");
  if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  const high = Number.parseInt(words[0]!, 16);
  const low = Number.parseInt(words[1]!, 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

/** Reject every non-routable, private, documentation, multicast and IPv4-mapped private IP. */
export function isPublicNetworkAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !privateIpv4(address);
  if (version !== 6) return false;
  const normalized = address.toLowerCase();
  const mapped = mappedIpv4(normalized);
  if (mapped) return !privateIpv4(mapped);
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8") ||
    normalized.startsWith("2001:2:") ||
    normalized.startsWith("2001:10:")
  );
}
