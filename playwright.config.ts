import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Auxiliary profiles keep their own server lifecycle and are deliberately excluded here.
  testIgnore: [
    /visual\.spec\.ts/,
    /runtime-starter\.spec\.ts/,
    /offline-smoke\.spec\.ts/,
    /accessibility\.spec\.ts/,
    /security\.spec\.ts/
  ],
  timeout: 60_000,
  // Sheets and the game layer are lazy chunks, and behind a dev server the first request for one
  // is also its first transform. With the whole suite running in parallel that can outlast the
  // default five seconds — long enough to fail a test that is, on its own, perfectly fine.
  expect: { timeout: 10_000 },
  // Every spec opens a WebGL map, so workers compete for the GPU and for the dev server's
  // transform queue rather than just for cores. Playwright's default (half the cores) oversubscribes
  // that badly enough that failures start reporting how busy the machine was.
  workers: 3,
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
    // A service worker can otherwise satisfy a request before Playwright's zero-upstream route
    // sees it. The release profile deliberately tests the ordinary page/network path only.
    serviceWorkers: "block"
  },
  webServer: [
    {
      command:
        "MAPOS_FIXTURE_MODE=offline MAPOS_E2E_RATE_LIMIT_MULTIPLIER=100 npm run dev:memory -w @mapos/api",
      // A bound port only proves the process reached `listen`; the first specs were reaching Vite's
      // proxy while routes were still registering, so the whole first second of the run answered
      // /config and /auth/guest with ECONNREFUSED. Polling /health waits for a served response.
      url: "http://127.0.0.1:4033/health",
      // Reusing an arbitrary developer process would silently drop the server-side offline guard.
      reuseExistingServer: false
    },
    {
      command: "npm run dev -w @mapos/web",
      port: 5173,
      reuseExistingServer: false
    }
  ]
});
