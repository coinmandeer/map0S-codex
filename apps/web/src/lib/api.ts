/** `import.meta.env` only exists under Vite; in the Node test runner it is undefined, and
 *  reading a property off it threw before any test could run. */
const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

export const API_BASE = viteEnv?.VITE_API_BASE_URL ?? "/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
  /** Send the session cookie. Required for anything user-scoped. */
  auth?: boolean;
  query?: Record<string, string | number | boolean | string[] | undefined | null>;
}

export function buildQuery(
  query: Record<string, string | number | boolean | string[] | undefined | null> | undefined
): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

async function parseError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as { message?: string } | null;
  return data?.message ?? `${res.status} ${res.statusText}`;
}

export async function apiGet<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}${buildQuery(options.query)}`, {
    signal: options.signal,
    credentials: options.auth ? "include" : "same-origin"
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  return (await res.json()) as T;
}

export async function apiSend<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  options: ApiRequestOptions = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}${buildQuery(options.query)}`, {
    method,
    signal: options.signal,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function apiPost<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
  return apiSend<T>("POST", path, body, options);
}

/** Resolves to `null` instead of throwing — for optional/degradable data sources. */
export async function apiGetSafe<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T | null> {
  try {
    return await apiGet<T>(path, options);
  } catch {
    return null;
  }
}
