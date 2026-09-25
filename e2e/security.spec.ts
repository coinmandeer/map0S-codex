import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures/offlineTest";
import { openAccessibleMapFeature } from "./fixtures/discoverContext";

const SECURITY_HEADERS = readFileSync(
  new URL("../infra/security-headers.inc", import.meta.url),
  "utf8"
);
const CSP_MATCH = SECURITY_HEADERS.match(
  /add_header\s+Content-Security-Policy\s+"([^"]+)"\s+always;/
);
if (!CSP_MATCH) throw new Error("Production Content-Security-Policy header not found");
const PRODUCTION_CSP = CSP_MATCH[1]!;
const CSP_REPORT_PATH = "/api/security/csp-report";
const XSS_TEXT =
  '"><img src=x onerror="window.__maposTextXss=1"><script>window.__maposTextXss=2</script>';

interface BrowserViolation {
  blockedURI: string;
  disposition: string;
  effectiveDirective: string;
  originalPolicy: string;
  violatedDirective: string;
}

type SecurityWindow = Window &
  typeof globalThis & {
    __maposCspProbeExecuted?: boolean;
    __maposTextXss?: number;
    __maposCspViolations?: BrowserViolation[];
  };

test("untrusted UI text stays inert and production CSP blocks and reports an inline script", async ({
  page
}) => {
  const reports: Array<Record<string, unknown>> = [];

  await page.addInitScript(() => {
    const target = window as SecurityWindow;
    target.__maposCspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      target.__maposCspViolations?.push({
        blockedURI: event.blockedURI,
        disposition: event.disposition,
        effectiveDirective: event.effectiveDirective,
        originalPolicy: event.originalPolicy,
        violatedDirective: event.violatedDirective
      });
    });
  });

  page.on("request", (request) => {
    if (request.method() !== "POST" || new URL(request.url()).pathname !== CSP_REPORT_PATH) return;
    try {
      reports.push(request.postDataJSON() as Record<string, unknown>);
    } catch {
      reports.push({ malformed: true });
    }
  });

  // Exercise the real production UI under the exact enforcing policy shipped by Nginx. Requests
  // fall through to the offline fixture, which fails the test on any unexpected public origin.
  await page.route("http://localhost:5173/**", async (route) => {
    if (route.request().resourceType() !== "document") {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": PRODUCTION_CSP }
    });
  });

  await page.route("**/api/layers/osm-poi/features**", async (route) => {
    const bbox = new URL(route.request().url()).searchParams.get("bbox")!.split(",").map(Number);
    const [west, south, east, north] = bbox;
    await route.fulfill({
      json: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [(west! + east!) / 2, (south! + north!) / 2]
            },
            properties: {
              id: "xss-fixture",
              layerId: "osm-poi",
              category: "viewpoint",
              name: XSS_TEXT
            }
          }
        ]
      }
    });
  });

  await page.goto("/?layers=osm-poi&lng=13.3775&lat=49.7475&z=14");
  // The provider-controlled name reaches the DOM twice: in Discover's list of places on the map
  // and in the place sheet it opens. This profile runs the production bundle, which exposes no
  // map handle to click through, so the pin is opened the way a keyboard user opens it.
  await openAccessibleMapFeature(page, XSS_TEXT);
  await expect(page.getByTestId("discover-map-features")).toContainText(XSS_TEXT);
  const textSurface = page.getByTestId("pin-detail");
  await expect(textSurface).toContainText(XSS_TEXT, { timeout: 20_000 });
  await expect(textSurface.locator("script")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as SecurityWindow).__maposTextXss),
    "the provider-controlled name must be a text node, never executable markup"
  ).toBeUndefined();

  const reportResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === CSP_REPORT_PATH
  );
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__maposCspProbeExecuted = true";
    document.head.append(script);
  });

  expect(
    await page.evaluate(() => (window as SecurityWindow).__maposCspProbeExecuted),
    "the enforcing production script-src must reject inline execution"
  ).toBeUndefined();
  expect((await reportResponse).status()).toBe(204);

  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as SecurityWindow).__maposCspViolations?.find(
            (violation) =>
              violation.blockedURI === "inline" &&
              violation.effectiveDirective === "script-src-elem"
          ) ?? null
      )
    )
    .toMatchObject({
      blockedURI: "inline",
      disposition: "enforce",
      effectiveDirective: "script-src-elem"
    });

  const browserReport = reports
    .map((report) => report["csp-report"])
    .find(
      (report): report is Record<string, unknown> =>
        Boolean(report) &&
        typeof report === "object" &&
        (report as Record<string, unknown>)["blocked-uri"] === "inline"
    );
  expect(browserReport).toMatchObject({
    "blocked-uri": "inline",
    disposition: "enforce",
    "effective-directive": "script-src-elem"
  });
  expect(String(browserReport?.["original-policy"])).toContain(`report-uri ${CSP_REPORT_PATH}`);
});
