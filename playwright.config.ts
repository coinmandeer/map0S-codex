import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:5173",
    headless: true
  },
  webServer: [
    {
      command: "npm run dev:memory -w @mapos/api",
      port: 4033,
      reuseExistingServer: true
    },
    {
      command: "npm run dev -w @mapos/web",
      port: 5173,
      reuseExistingServer: true
    }
  ]
});
