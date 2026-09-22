import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function build(base, outDir) {
  const result = spawnSync(
    npm,
    ["run", "build", "--workspace", "@macro-nation/web", "--", "--outDir", outDir],
    {
      cwd: root,
      env: { ...process.env, VITE_BASE_PATH: base },
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const outputPath = join(root, "apps/web", outDir);
  const html = readFileSync(join(outputPath, "index.html"), "utf8");
  const expectedAssetPrefix = base === "/" ? "/assets/" : `${base}assets/`;

  if (!html.includes(expectedAssetPrefix)) {
    throw new Error(
      `Built HTML did not contain expected asset prefix "${expectedAssetPrefix}" for base "${base}".`,
    );
  }

  rmSync(outputPath, { recursive: true, force: true });
}

build("/", "dist-root-smoke");
build("/macro-nation/", "dist-subdir-smoke");

console.log("Xserver root/subdirectory production build smoke OK");
