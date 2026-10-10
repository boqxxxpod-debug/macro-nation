import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npmEntry = process.env.npm_execpath;

function build(base, outDir) {
  const result = spawnSync(
    npmEntry ? process.execPath : npm,
    [
      ...(npmEntry ? [npmEntry] : []),
      "run",
      "build",
      "--workspace",
      "@macro-nation/web",
      "--",
      "--outDir",
      outDir,
    ],
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

  // Public portraits must ship byte-for-byte and be revisioned for offline updates.
  const portraits = JSON.parse(
    readFileSync(
      join(root, "docs/assets/expert-portraits-v1/manifest.json"),
      "utf8",
    ),
  ).experts.flatMap((expert) => expert.variants);
  const serviceWorker = readFileSync(join(outputPath, "sw.js"), "utf8");
  const expectedFiles = portraits.map((variant) =>
    variant.file.split("/").at(-1),
  );
  const builtFiles = readdirSync(join(outputPath, "experts")).sort();
  if (JSON.stringify(builtFiles) !== JSON.stringify(expectedFiles.sort())) {
    throw new Error(
      `Portrait files missing or duplicated in build for ${base}`,
    );
  }
  for (const variant of portraits) {
    const assetPath = variant.file.replace("apps/web/public/", "");
    if (
      !readFileSync(join(outputPath, assetPath)).equals(
        readFileSync(join(root, variant.file)),
      ) ||
      !serviceWorker.includes(`url:"${assetPath}",revision:`)
    ) {
      throw new Error(
        `Portrait ${assetPath} did not ship with a PWA revision for ${base}`,
      );
    }
  }

  rmSync(outputPath, { recursive: true, force: true });
}

build("/", "dist-root-smoke");
build("/macro-nation/", "dist-subdir-smoke");

console.log("Xserver root/subdirectory production build smoke OK");
