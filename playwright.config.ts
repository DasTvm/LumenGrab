import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: "http://localhost:1420",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm dev:web",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env["CI"],
  },
});
