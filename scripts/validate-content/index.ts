import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  validateConfigPack,
  verifyFileHashes,
  type ConfigManifest,
} from "@macro-nation/model-config";

const root = resolve(process.cwd(), "packages/model-config/data");

async function text(path: string): Promise<string> {
  return readFile(resolve(root, path), "utf8");
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await text(path)) as T;
}

const manifest = await json<ConfigManifest>("manifest.json");
const fileContents = Object.fromEntries(
  await Promise.all(
    Object.keys(manifest.files).map(async (path) => [path, await text(path)] as const),
  ),
);

await verifyFileHashes(manifest, fileContents);

const pack = validateConfigPack({
  manifest,
  coefficients: JSON.parse(fileContents["models/balanced-v0.1.0.json"] ?? "{}"),
  lagKernels: JSON.parse(fileContents["tuning/lagKernels.json"] ?? "{}"),
  shockModel: JSON.parse(fileContents["tuning/shockModel.json"] ?? "{}"),
  policyRules: JSON.parse(fileContents["tuning/policyRules.json"] ?? "{}"),
  calibrationTargets: JSON.parse(fileContents["tuning/calibrationTargets.json"] ?? "{}"),
  sources: JSON.parse(fileContents["tuning/sources.json"] ?? "{}"),
  nations: [JSON.parse(fileContents["nations/standard-nation-v1.json"] ?? "{}")],
  scenarios: [JSON.parse(fileContents["scenarios/scn01-v1.json"] ?? "{}")],
  content: JSON.parse(fileContents["content/content-v1.json"] ?? "{}"),
  limits: JSON.parse(fileContents["tuning/limits-v1.json"] ?? "{}"),
  effectCurves: JSON.parse(fileContents["tuning/effect-curves-v1.json"] ?? "{}"),
});

console.log(
  `Config content OK: ${pack.manifest.configPackId} (${pack.coefficients.parameters.length} parameters)`,
);
