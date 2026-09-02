import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /runtime-starter\.spec\.ts/,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "test-results/runtime-starter",
  use: {
    baseURL: "http://localhost:5180",
    headless: true,
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off"
  },
  webServer: {
    command: "npm run dev -w @mapos/runtime-starter",
    port: 5180,
    reuseExistingServer: false
  }
});
