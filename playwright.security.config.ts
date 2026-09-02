import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig({
  ...baseConfig,
  testMatch: /security\.spec\.ts/,
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "test-results/security",
  use: {
    ...baseConfig.use,
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off"
  },
  webServer: [
    {
      command:
        "MAPOS_FIXTURE_MODE=offline MAPOS_E2E_RATE_LIMIT_MULTIPLIER=100 npm run dev:memory -w @mapos/api",
      port: 4033,
      reuseExistingServer: false
    },
    {
      // The React development transform injects an inline hot-reload preamble. Exercise the
      // production bundle so an enforcing script-src can stay identical to the Nginx policy.
      command:
        "npm run build -w @mapos/web && npm run preview -w @mapos/web -- --host 0.0.0.0 --port 5173",
      port: 5173,
      reuseExistingServer: false
    }
  ]
});
