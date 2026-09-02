import { expect, test, type Page } from "./fixtures/offlineTest";

interface ApiResult<T = unknown> {
  status: number;
  headers: Record<string, string>;
  body: T | null;
}

async function api<T>(
  page: Page,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const response = await fetch(`/api${path}`, {
        method,
        credentials: "include",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: response.status === 204 ? null : await response.json().catch(() => null)
      };
    },
    { method, path, body }
  ) as Promise<ApiResult<T>>;
}

test("owner archive and deletion cover places, plans, layers/pins and comments", async ({
  page
}) => {
  await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");
  await expect
    .poll(
      async () => (await api<{ user: { id: string } | null }>(page, "GET", "/auth/me")).body?.user
    )
    .not.toBeNull();

  const suffix = Date.now().toString(36);
  const layerResponse = await api<{ layer: { id: string; slug: string } }>(
    page,
    "POST",
    "/user-layers",
    { name: `Privacy layer ${suffix}`, color: "#123456" }
  );
  expect(layerResponse.status).toBe(200);
  const layer = layerResponse.body!.layer;
  const pinResponse = await api<{ pin: { id: string } }>(
    page,
    "POST",
    `/user-layers/${layer.id}/pins`,
    { name: "Privacy pin", lng: 13.3775, lat: 49.7475 }
  );
  expect(pinResponse.status).toBe(200);
  const pin = pinResponse.body!.pin;
  await api(page, "PATCH", `/user-layers/${layer.id}`, { isPublic: true });

  const savedResponse = await api<{ savedPlace: { id: string } }>(
    page,
    "POST",
    "/v2/me/saved-places",
    {
      target: { type: "user-pin", userPinId: pin.id },
      snapshot: {
        title: "Privacy saved place",
        position: [13.3775, 49.7475],
        sourceRefs: [],
        capturedAt: "2026-09-01T08:00:00.000Z"
      },
      note: "owner-only export note"
    }
  );
  expect(savedResponse.status).toBe(201);

  const planResponse = await api<{ plan: { id: string } }>(page, "POST", "/plans", {
    name: "Privacy plan",
    departureAt: "2026-09-01T08:00:00.000Z",
    variant: "fast",
    stops: [
      { id: "privacy-a", name: "A", lng: 13.3775, lat: 49.7475, dwellMinutes: 0 },
      { id: "privacy-b", name: "B", lng: 13.4, lat: 49.75, dwellMinutes: 0 }
    ],
    vehicle: { profile: "car" },
    visibility: "private"
  });
  expect(planResponse.status).toBe(200);

  const commentResponse = await api<{ comment: { id: string } }>(page, "POST", "/comments", {
    targetType: "place",
    targetId: pin.id,
    body: "Privacy comment"
  });
  expect(commentResponse.status).toBe(200);

  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "session"
  );
  expect(sessionCookie?.value).toBeTruthy();
  const exported = await api<{
    schema: string;
    exclusions: string[];
    layers: Array<{ id: string; pins: Array<{ id: string }> }>;
    places: { saved: Array<{ id: string }> };
    plans: Array<{ id: string }>;
    social: { comments: Array<{ id: string }> };
  }>(page, "GET", "/v2/me/export");
  expect(exported.status).toBe(200);
  expect(exported.headers["cache-control"]).toContain("no-store");
  expect(exported.headers["content-disposition"]).toContain("mapos-account-export.json");
  expect(exported.body?.schema).toBe("mapos.account-export");
  expect(exported.body?.layers.find((item) => item.id === layer.id)?.pins).toContainEqual(
    expect.objectContaining({ id: pin.id })
  );
  expect(exported.body?.places.saved).toContainEqual(
    expect.objectContaining({ id: savedResponse.body!.savedPlace.id })
  );
  expect(exported.body?.plans).toContainEqual(
    expect.objectContaining({ id: planResponse.body!.plan.id })
  );
  expect(exported.body?.social.comments).toContainEqual(
    expect.objectContaining({ id: commentResponse.body!.comment.id })
  );
  expect(JSON.stringify(exported.body)).not.toContain(sessionCookie!.value);
  expect(exported.body?.exclusions).toContain("password-hashes");

  const deleted = await api<{ status: string; retained: unknown[] }>(page, "DELETE", "/v2/me", {
    confirmation: "DELETE MY ACCOUNT"
  });
  expect(deleted.status).toBe(200);
  expect(deleted.body).toEqual({ status: "deleted", retained: [] });
  expect((await api<{ user: unknown }>(page, "GET", "/auth/me")).body?.user).toBeNull();
  expect((await api(page, "GET", "/v2/me/export")).status).toBe(401);
  expect((await api(page, "GET", `/l/${layer.slug}`)).status).toBe(404);
  const comments = await api<{ comments: Array<{ id: string }> }>(
    page,
    "GET",
    `/comments?targetType=place&targetId=${encodeURIComponent(pin.id)}`
  );
  expect(comments.body?.comments).not.toContainEqual(
    expect.objectContaining({ id: commentResponse.body!.comment.id })
  );
});
