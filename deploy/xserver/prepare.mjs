import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = join(root, "apps/web/dist");

function normalizeBasePath(input) {
  const value = input?.trim() || "/";
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

if (!existsSync(join(dist, "index.html"))) {
  throw new Error("apps/web/dist is missing. Run the production build first.");
}

const base = normalizeBasePath(process.env.XSERVER_BASE_PATH ?? process.env.VITE_BASE_PATH);
const template = readFileSync(join(root, "deploy/xserver/.htaccess.template"), "utf8");
writeFileSync(join(dist, ".htaccess"), template.replaceAll("__BASE_PATH__", base), "utf8");

console.log(`Prepared Xserver SPA fallback for base path ${base}`);
