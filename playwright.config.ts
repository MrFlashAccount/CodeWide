import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results/playwright",
  fullyParallel: false,
  workers: process.env.CI ? 2 : 4,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8084",
    colorScheme: "dark",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "CI=1 pnpm --filter @codewide/android exec expo start --web --port 8084",
    url: "http://127.0.0.1:8084",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    {
      name: "fold",
      use: { viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1 },
    },
    {
      name: "tablet",
      use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    },
  ],
});
