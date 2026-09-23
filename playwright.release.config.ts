import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const apiPort = Number(process.env.MAPOS_E2E_API_PORT ?? 4043);
const webPort = Number(process.env.MAPOS_E2E_WEB_PORT ?? 5183);

// Dedicated processes prevent a developer server or another task from changing the fixtures.
// The ordinary production build is validated separately; these flows use the development
// inspection bridge required by existing map and game assertions.
export default defineConfig({
  ...base,
  testMatch:
    /(?:smoke|offline-smoke|basemap|discoverBoundaries|performanceMap|czechLayers|search|placeDetail|planning|personal|aiPanel|customPresets|viewportRefresh|game|game-performance|accessibility|authAndOwnership|gpxImport|tableImport|weatherAdaptive)\.spec\.ts/,
  testIgnore: [],
  workers: 1,
  retries: 0,
  outputDir: "output/release/browser",
  reporter: [["list"], ["json", { outputFile: "output/release/browser-results.json" }]],
  use: {
    ...base.use,
    baseURL: `http://localhost:${webPort}`,
    channel: process.env.MAPOS_E2E_CHANNEL || undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: `node --import tsx apps/api/src/memory-server.ts`,
      env: {
        PORT: String(apiPort),
        MAPOS_WORLD_ORIGIN: `http://localhost:${webPort}`,
        MAPOS_CORS_ORIGINS: `http://localhost:${webPort}`,
        MAPOS_FIXTURE_MODE: "offline",
        MAPOS_E2E_RATE_LIMIT_MULTIPLIER: "100",
        MAPOS_GAME_TEST_MOVEMENT: "0"
      },
      url: `http://127.0.0.1:${apiPort}/health`,
      timeout: 120_000,
      reuseExistingServer: false
    },
    {
      command: `node ../../node_modules/vite/bin/vite.js --port ${webPort} --strictPort`,
      cwd: "apps/web",
      env: { MAPOS_DEV_API_PORT: String(apiPort) },
      url: `http://localhost:${webPort}`,
      timeout: 120_000,
      reuseExistingServer: false
    }
  ]
});
