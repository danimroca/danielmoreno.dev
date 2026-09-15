import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Cap concurrency so local runs (and CI) don't spawn one worker per core.
  // On a 16-core box, fullyParallel:true + 3 browser projects saturated the CPU.
  fullyParallel: false,
  workers: Number(process.env.PW_WORKERS || 2),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: "node tests/server.mjs",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
