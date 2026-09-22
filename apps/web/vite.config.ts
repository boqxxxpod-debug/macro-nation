import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

function normalizeBasePath(input: string | undefined): string {
  const trimmed = input?.trim() || "/";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

const base = normalizeBasePath(process.env.VITE_BASE_PATH);

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icons/icon.svg"],
      manifest: {
        name: "MACRO NATION",
        short_name: "MACRO NATION",
        description: "Nation-management macroeconomic simulation game",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#f6f5ef",
        theme_color: "#1f2937",
        icons: [
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "index.html",
        globPatterns: ["**/*.{js,css,html,svg,webmanifest}"],
      },
    }),
  ],
});
