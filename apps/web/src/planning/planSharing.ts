export const PLAN_SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function planShareTokenFromLocation(pathname: string, hash: string): string | null {
  if (!/^\/s\/?$/.test(pathname)) return null;
  const encoded = hash.startsWith("#plan=") ? hash.slice(6) : "";
  if (!encoded) return null;
  let token: string;
  try {
    token = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  return PLAN_SHARE_TOKEN.test(token) ? token : null;
}

export function buildPlanShareUrl(origin: string, token: string): string {
  if (!PLAN_SHARE_TOKEN.test(token)) throw new TypeError("Invalid plan share token");
  return `${origin.replace(/\/$/, "")}/s?mode=planning#plan=${token}`;
}
