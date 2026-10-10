import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

const baseURL = "http://127.0.0.1:4174/macro-nation/";

export default defineConfig({
  ...baseConfig,
  testMatch: "**/expert-portraits.spec.ts",
  outputDir: "test-results-pages",
  use: { ...baseConfig.use, baseURL },
  webServer: {
    command:
      "npm run build:pages && npm run preview --workspace @macro-nation/web -- --host 127.0.0.1 --port 4174",
    url: baseURL,
    env: { VITE_BASE_PATH: "/macro-nation/", VITE_AI_ENABLED: "false" },
    reuseExistingServer: false,
  },
});
