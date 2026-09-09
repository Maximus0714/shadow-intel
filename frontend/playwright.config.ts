import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4180",
    headless: true,
    reducedMotion: "reduce",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROME_PATH || undefined,
    },
  },
  webServer: [
    {
      command: `"${process.env.PLAYWRIGHT_PYTHON || "python3"}" -m uvicorn backend.api:app --host 127.0.0.1 --port 18000`,
      cwd: "..",
      url: "http://127.0.0.1:18000/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "npm run build && npm run preview -- --host 127.0.0.1 --port 4180 --strictPort",
      env: {
        API_PROXY_TARGET: "http://127.0.0.1:18000",
        VITE_SUPABASE_URL: "",
        VITE_SUPABASE_ANON_KEY: "",
      },
      url: "http://127.0.0.1:4180",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
