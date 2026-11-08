import { defineConfig, devices } from "@playwright/test";

// Without BASE_URL, tests run against `vite preview` of the production build in dist/.
const baseURL = process.env["BASE_URL"] ?? "http://localhost:4173";

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"]
    ? [["list"], ["html", { open: "never" }]]
    : "list",
  use: { baseURL },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: process.env["BASE_URL"]
    ? undefined
    : {
        command: "npx vite preview --port 4173 --strictPort",
        url: baseURL,
        reuseExistingServer: !process.env["CI"],
      },
});
