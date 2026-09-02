import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig({
  ...baseConfig,
  testMatch: /accessibility\.spec\.ts/,
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "test-results/accessibility",
  use: {
    ...baseConfig.use,
    serviceWorkers: "block",
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
    reducedMotion: "reduce"
  },
  webServer: [
    {
      command:
        "MAPOS_FIXTURE_MODE=offline MAPOS_E2E_RATE_LIMIT_MULTIPLIER=100 npm run dev:memory -w @mapos/api",
      port: 4033,
      reuseExistingServer: false
    },
    {
      command: "npm run dev -w @mapos/web",
      port: 5173,
      reuseExistingServer: false
    }
  ]
});
