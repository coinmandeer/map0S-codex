const LOOPBACK_HOST = /^(?:localhost|.+\.localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i;
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export function isOfflineFixtureMode(
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  return env.MAPOS_FIXTURE_MODE === "offline";
}

/** Shared non-`fetch` transports call this before DNS so offline mode is a process boundary. */
export function assertExternalNetworkAllowed(): void {
  if (isOfflineFixtureMode()) {
    throw new Error("Offline fixture mode blocked an outbound provider request");
  }
}

export function isLoopbackRequest(input: FetchInput) {
  const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "file:";
  }
  return LOOPBACK_HOST.test(url.hostname);
}

/**
 * Wraps fetch for the explicit offline fixture process. Loopback calls are useful for local
 * composition tests, but any request that could leave the machine fails before the delegate is
 * invoked. Keeping this at the process boundary also catches a newly added provider whose route
 * forgot to opt into a recorded fixture.
 */
export function createOfflineFetchGuard(delegate: typeof fetch = globalThis.fetch): typeof fetch {
  return (async (input: FetchInput, init?: FetchInit) => {
    if (isLoopbackRequest(input)) return delegate(input, init);

    const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    let destination = "external destination";
    try {
      const url = new URL(raw);
      destination = `${url.protocol}//${url.host}`;
    } catch {
      // A malformed or relative server-side fetch is blocked as well. Do not echo the full input:
      // query strings can contain provider keys.
    }
    throw new Error(`Offline fixture mode blocked outbound fetch to ${destination}`);
  }) as typeof fetch;
}

export function installOfflineFetchGuard() {
  const originalFetch = globalThis.fetch;
  const guardedFetch = createOfflineFetchGuard(originalFetch);
  globalThis.fetch = guardedFetch;

  return () => {
    if (globalThis.fetch === guardedFetch) globalThis.fetch = originalFetch;
  };
}
