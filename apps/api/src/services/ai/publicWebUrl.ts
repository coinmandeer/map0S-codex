import { isIP } from "node:net";
/** Reject literal IPs (including alternate encodings normalized by URL), local names and
 * credentials before handing a URL to the remote fetch service. DNS/redirect enforcement also
 * remains the fetching provider's responsibility; this is not a generic server-side proxy. */
export function publicWebUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes(".") ||
      isIP(host.replace(/^\[|\]$/g, "")) ||
      /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host)
    )
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}
