/** `import.meta.env` only exists under Vite; in the Node test runner it is undefined, and
 *  reading a property off it threw before any test could run. */
const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

export const API_BASE = viteEnv?.VITE_API_BASE_URL ?? "/api";

const SAFE_REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export interface ApiResponseWithMetadata<T> {
  data: T;
  /** Validated server-generated X-Request-ID; never derived from a URL or request body. */
  requestId: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly requestId: string | null = null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function safeApiRequestId(value: string | null): string | null {
  return value !== null && SAFE_REQUEST_ID.test(value) ? value : null;
}

function responseRequestId(response: Response): string | null {
  return safeApiRequestId(response.headers.get("X-Request-ID"));
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

export async function apiGetWithMetadata<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<ApiResponseWithMetadata<T>> {
  const res = await fetch(`${API_BASE}${path}${buildQuery(options.query)}`, {
    signal: options.signal,
    credentials: options.auth ? "include" : "same-origin"
  });
  const requestId = responseRequestId(res);
  if (!res.ok) throw new ApiError(res.status, await parseError(res), requestId);
  return { data: (await res.json()) as T, requestId };
}

export async function apiGet<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return (await apiGetWithMetadata<T>(path, options)).data;
}

export async function apiSendWithMetadata<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  options: ApiRequestOptions = {}
): Promise<ApiResponseWithMetadata<T>> {
  const res = await fetch(`${API_BASE}${path}${buildQuery(options.query)}`, {
    method,
    signal: options.signal,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const requestId = responseRequestId(res);
  if (!res.ok) throw new ApiError(res.status, await parseError(res), requestId);
  if (res.status === 204) return { data: undefined as T, requestId };
  return { data: (await res.json()) as T, requestId };
}

export async function apiSend<T>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  options: ApiRequestOptions = {}
): Promise<T> {
  return (await apiSendWithMetadata<T>(method, path, body, options)).data;
}

export function apiPost<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
  return apiSend<T>("POST", path, body, options);
}

export function apiPostWithMetadata<T>(
  path: string,
  body?: unknown,
  options?: ApiRequestOptions
): Promise<ApiResponseWithMetadata<T>> {
  return apiSendWithMetadata<T>("POST", path, body, options);
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
