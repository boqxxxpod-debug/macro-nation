import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function fail(message) {
  console.error(`Architecture boundary violation: ${message}`);
  process.exitCode = 1;
}

const requiredDirectories = [
  "apps/web/src/application",
  "apps/web/src/infrastructure",
  "apps/web/src/store",
  "apps/web/src/ui",
  "apps/web/src/pwa",
  "apps/web/src/devtools",
  "packages/domain",
  "packages/simulation-engine",
  "packages/model-config",
  "packages/advisor-core",
  "deploy/xserver",
];

for (const directory of requiredDirectories) {
  if (!existsSync(join(root, directory))) {
    fail(`missing required directory ${directory}`);
  }
}

const engineRoot = join(root, "packages/simulation-engine/src");
const engineForbidden = [
  [/\bMath\.random\s*\(/, "Math.random"],
  [/\bDate\.now\s*\(/, "Date.now"],
  [/\bindexedDB\b/, "IndexedDB"],
  [/\blocalStorage\b/, "localStorage"],
  [/\bwindow\b/, "window"],
  [/\bdocument\b/, "document"],
  [/\bnavigator\b/, "navigator"],
  [/from\s+["']react(?:-dom)?["']/, "React"],
  [/from\s+["']dexie["']/, "Dexie"],
];

for (const file of walk(engineRoot).filter(
  (path) => extname(path) === ".ts" && !path.endsWith(".test.ts"),
)) {
  const source = readFileSync(file, "utf8");
  for (const [pattern, label] of engineForbidden) {
    if (pattern.test(source)) {
      fail(`${relative(root, file)} references forbidden dependency ${label}`);
    }
  }
}

const uiRoot = join(root, "apps/web/src/ui");
for (const file of walk(uiRoot).filter((path) =>
  [".ts", ".tsx"].includes(extname(path)),
)) {
  const source = readFileSync(file, "utf8");
  if (/["']@macro-nation\/simulation-engine(?:\/|["'])/.test(source)) {
    fail(`${relative(root, file)} imports Simulation Engine directly; route through application`);
  }
  if (/\bindexedDB\b|from\s+["']dexie["']/.test(source)) {
    fail(`${relative(root, file)} accesses persistence directly`);
  }
}

const enginePackage = JSON.parse(
  readFileSync(join(root, "packages/simulation-engine/package.json"), "utf8"),
);
if (Object.keys(enginePackage.exports ?? {}).some((key) => key !== ".")) {
  fail("simulation-engine exposes internal subpaths; only the public root export is allowed");
}

if (!process.exitCode) {
  console.log("Architecture boundaries OK");
}
