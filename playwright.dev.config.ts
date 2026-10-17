import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

const baseURL = "http://127.0.0.1:5173";

export default defineConfig({
  ...baseConfig,
  testMatch: "**/ai-preview.spec.ts",
  outputDir: "test-results-dev",
  use: { ...baseConfig.use, baseURL },
  webServer: {
    command:
      "npm run dev --workspace @macro-nation/web -- --host 127.0.0.1 --port 5173 --strictPort",
    url: baseURL,
    env: { VITE_BASE_PATH: "/", VITE_AI_ENABLED: "false" },
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium-dev" }],
});
