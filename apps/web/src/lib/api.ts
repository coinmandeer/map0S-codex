/** `import.meta.env` only exists under Vite; in the Node test runner it is undefined, and
 *  reading a property off it threw before any test could run. */
const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

export const API_BASE = viteEnv?.VITE_API_BASE_URL ?? "/api";

const SAFE_REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export interface ApiResponseWithMetadata<T> {
  data: T;
  /** Validated server-generated X-Request-ID; never derived from a URL or request body. */
  requestId: string | null;
  cacheControl?: string | null;
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

interface SharedGet {
  promise: Promise<ApiResponseWithMetadata<unknown>>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
}

/** Identical GETs issued while one is still in flight share its network request. Two panels
 *  asking for the same theme list or the same place at startup used to cost two round trips. */
const inflightGets = new Map<string, SharedGet>();

function abortError(): Error {
  return new DOMException("The operation was aborted.", "AbortError");
}

async function fetchGet<T>(
  url: string,
  credentials: RequestCredentials,
  signal: AbortSignal
): Promise<ApiResponseWithMetadata<T>> {
  const res = await fetch(url, { signal, credentials });
  const requestId = responseRequestId(res);
  if (!res.ok) throw new ApiError(res.status, await parseError(res), requestId);
  return {
    data: (await res.json()) as T,
    requestId,
    cacheControl: res.headers.get("cache-control")
  };
}

export async function apiGetWithMetadata<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<ApiResponseWithMetadata<T>> {
  const url = `${API_BASE}${path}${buildQuery(options.query)}`;
  const credentials: RequestCredentials = options.auth ? "include" : "same-origin";
  const key = `${credentials} ${url}`;
  options.signal?.throwIfAborted();
  let shared = inflightGets.get(key);
  const joined = Boolean(shared);
  if (!shared) {
    const controller = new AbortController();
    const entry: SharedGet = {
      controller,
      consumers: 0,
      settled: false,
      promise: fetchGet<unknown>(url, credentials, controller.signal).finally(() => {
        entry.settled = true;
        if (inflightGets.get(key) === entry) inflightGets.delete(key);
      })
    };
    shared = entry;
    inflightGets.set(key, entry);
  }
  const entry = shared;
  entry.consumers++;
  // Each caller can still cancel on its own; the shared request is aborted only once nobody is
  // waiting for it any more.
  const release = () => {
    entry.consumers--;
    if (entry.consumers <= 0 && !entry.settled) {
      entry.controller.abort();
      if (inflightGets.get(key) === entry) inflightGets.delete(key);
    }
  };
  let onAbort: (() => void) | undefined;
  const cancelled = options.signal
    ? new Promise<never>((_, reject) => {
        onAbort = () => reject(abortError());
        options.signal!.addEventListener("abort", onAbort, { once: true });
      })
    : null;
  try {
    const result = (await (cancelled
      ? Promise.race([entry.promise, cancelled])
      : entry.promise)) as ApiResponseWithMetadata<T>;
    // A caller that joined gets its own copy, so one consumer mutating the payload cannot change
    // what another one rendered.
    return joined ? { ...result, data: structuredClone(result.data) } : result;
  } finally {
    if (onAbort) options.signal?.removeEventListener("abort", onAbort);
    release();
  }
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

/**
 * POST that reads a `text/event-stream` back.
 *
 * `EventSource` cannot POST, and the assistant has to send the map context with the question, so
 * the stream is parsed here. Events are delivered as they arrive: the tool steps are the useful
 * part of the wait, and a stream buffered to the end would be no better than a plain request.
 */
export async function apiPostEventStream<T>(
  path: string,
  body: unknown,
  onEvent: (event: T) => void,
  options: ApiRequestOptions = {}
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}${buildQuery(options.query)}`, {
    method: "POST",
    signal: options.signal,
    credentials: "include",
    headers: { "Content-Type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new ApiError(res.status, await parseError(res), responseRequestId(res));
  if (!res.body) throw new ApiError(502, "Stream odpovědi není dostupný", null);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 1_048_576) throw new Error("Odpověď překročila limit přenosu.");
      let match = /\r?\n\r?\n/.exec(buffer);
      while (match) {
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) {
          let event: T;
          try {
            event = JSON.parse(data) as T;
          } catch {
            throw new Error("Odpověď obsahuje neplatnou událost.");
          }
          // Handler validation errors must propagate, not silently disappear.
          onEvent(event);
        }
        match = /\r?\n\r?\n/.exec(buffer);
      }
    }
    if (buffer.trim()) throw new Error("Přenos odpovědi byl přerušen.");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
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
