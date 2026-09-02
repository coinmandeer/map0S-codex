function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`release HTTP drill failed: ${message}`);
}

async function json<T>(response: Response, operation: string): Promise<T> {
  const body = (await response.json()) as T & { message?: unknown };
  if (!response.ok) {
    throw new Error(
      `release HTTP drill failed: ${operation} returned ${response.status} (${typeof body.message === "string" ? body.message : "no safe message"})`
    );
  }
  return body;
}

/** Reproduces the headers the public TLS proxy gives to a same-origin browser mutation. */
export function candidateProxyHeaders(origin: string) {
  const publicOrigin = new URL(origin);
  expect(
    publicOrigin.protocol === "https:" && publicOrigin.origin === origin,
    "exact HTTPS public origin is missing"
  );
  return {
    origin: publicOrigin.origin,
    host: publicOrigin.host,
    "x-forwarded-host": publicOrigin.host,
    "x-forwarded-proto": "https"
  };
}

/**
 * Candidate-only HTTP acceptance. The rollout invokes it inside the private candidate API
 * container while that API points at the disposable restored database, never the live database.
 */
export async function runReleaseHttpDrill(
  baseUrl = "http://127.0.0.1:4033",
  origin = process.env.MAPOS_PUBLIC_ORIGIN
): Promise<void> {
  expect(typeof origin === "string", "exact HTTPS public origin is missing");
  const proxyHeaders = candidateProxyHeaders(origin);

  const guestResponse = await fetch(`${baseUrl}/auth/guest`, {
    method: "POST",
    headers: proxyHeaders
  });
  const guest = await json<{ user?: { id?: string } }>(guestResponse, "guest bootstrap");
  expect(guest.user?.id, "guest bootstrap did not return a user");
  const setCookie = guestResponse.headers.get("set-cookie") ?? "";
  const cookie = setCookie.match(/^[^;]+/)?.[0];
  expect(cookie, "guest bootstrap did not set a session cookie");

  const mutationHeaders = {
    ...proxyHeaders,
    "content-type": "application/json",
    cookie
  };
  const preview = await json<{
    previewId?: string;
    preview?: { featureCount?: number };
  }>(
    await fetch(`${baseUrl}/v2/layer-imports/preview`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        filename: "release-drill.geojson",
        document: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "release-drill-point",
              geometry: { type: "Point", coordinates: [14.4, 50.1] },
              properties: { name: "Release drill point" }
            }
          ]
        }
      })
    }),
    "layer import preview"
  );
  expect(preview.previewId, "preview ID is missing");
  expect(preview.preview?.featureCount === 1, "preview feature count is not one");

  const commit = await json<{ report?: { id?: string; layerId?: string; status?: string } }>(
    await fetch(`${baseUrl}/v2/layer-imports/${preview.previewId}/commit`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ visibility: "private" })
    }),
    "layer import commit"
  );
  expect(commit.report?.id, "commit report ID is missing");
  expect(commit.report.layerId, "committed layer ID is missing");
  expect(commit.report.status === "committed", "import was not committed");

  const rollback = await json<{ report?: { id?: string; layerId?: string; status?: string } }>(
    await fetch(`${baseUrl}/v2/layer-imports/${commit.report.id}/rollback`, {
      method: "POST",
      headers: { ...proxyHeaders, cookie }
    }),
    "layer import rollback"
  );
  expect(rollback.report?.id === commit.report.id, "rollback report changed identity");
  expect(rollback.report?.layerId === commit.report.layerId, "rollback report changed layer");
  expect(rollback.report?.status === "rolled-back", "import was not rolled back");

  const deletion = await json<{ status?: string; retained?: unknown[] }>(
    await fetch(`${baseUrl}/v2/me`, {
      method: "DELETE",
      headers: mutationHeaders,
      body: JSON.stringify({ confirmation: "DELETE MY ACCOUNT" })
    }),
    "fixture account cleanup"
  );
  expect(deletion.status === "deleted", "fixture account was not fully removed");
  expect(
    Array.isArray(deletion.retained) && deletion.retained.length === 0,
    "fixture was retained"
  );
}
