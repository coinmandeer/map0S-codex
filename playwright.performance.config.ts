import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// This build uses minified production React and bundled imports, with an explicit fixture
// bridge compiled in. Its separate output cannot overwrite the ordinary deployable build.
process.env.MAPOS_PERF_PRODUCTION = "1";
const webPort = Number(process.env.MAPOS_E2E_WEB_PORT ?? 5178);
export default defineConfig({
  ...base,
  testMatch: /performanceMap\.spec\.ts/,
  testIgnore: [],
  workers: 1,
  // The preview below serves on its own port; without this the inherited base URL points at the
  // dev server port unless MAPOS_E2E_WEB_PORT happens to be set to the same value.
  use: { ...base.use, baseURL: `http://localhost:${webPort}` },
  webServer: [
    (Array.isArray(base.webServer) ? base.webServer : [base.webServer])[0]!,
    {
      command: `npm exec -w @mapos/web -- vite build --mode performance --outDir ../../dist/performance-web --emptyOutDir && npm exec -w @mapos/web -- vite preview --outDir ../../dist/performance-web --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: { MAPOS_DEV_API_PORT: process.env.MAPOS_E2E_API_PORT ?? "4033" }
    }
  ]
});
