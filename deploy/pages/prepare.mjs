import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = join(root, "apps/web/dist");
const index = join(dist, "index.html");
const base = "/macro-nation/";

if (process.env.VITE_BASE_PATH !== base) {
  throw new Error(`Set VITE_BASE_PATH=${base} for project Pages deployment.`);
}
if (process.env.VITE_AI_ENABLED === "true") {
  throw new Error("GitHub Pages cannot serve the optional PHP AI proxy.");
}
if (
  !existsSync(index) ||
  !readFileSync(index, "utf8").includes(`${base}assets/`)
) {
  throw new Error(
    "Expected a production build with the GitHub Pages base path.",
  );
}
if (existsSync(join(dist, "api"))) {
  throw new Error(
    "GitHub Pages artifact must not include the Xserver PHP API.",
  );
}

// Pages serves this file for direct visits to the SPA's /game/... routes.
copyFileSync(index, join(dist, "404.html"));
writeFileSync(join(dist, ".nojekyll"), "");
