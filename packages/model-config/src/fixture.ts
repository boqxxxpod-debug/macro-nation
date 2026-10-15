import manifest from "../data/configpacks/advanced-small-open-v1.0.0/manifest.json";
import coefficients from "../data/configpacks/advanced-small-open-v1.0.0/coefficients.json";
import lagKernels from "../data/configpacks/advanced-small-open-v1.0.0/lagKernels.json";
import shockModel from "../data/configpacks/advanced-small-open-v1.0.0/shockModel.json";
import policyRules from "../data/configpacks/advanced-small-open-v1.0.0/policyRules.json";
import calibrationTargets from "../data/configpacks/advanced-small-open-v1.0.0/calibrationTargets.json";
import sources from "../data/configpacks/advanced-small-open-v1.0.0/sources.json";
import content from "../data/configpacks/advanced-small-open-v1.0.0/content.json";
import model from "../data/models/balanced-v0.1.0.json";
import limits from "../data/tuning/limits-v1.json";
import effectCurves from "../data/tuning/effect-curves-v1.json";
import nation from "../data/nations/standard-nation-v1.json";
import scenario from "../data/scenarios/scn01-v1.json";
import scn02 from "../data/scenarios/scn02-v1.json";
import scn03 from "../data/scenarios/scn03-v1.json";
import scn02Manifest from "../data/scenarios/scn02-manifest-v1.json";
import scn03Manifest from "../data/scenarios/scn03-manifest-v1.json";
import type { ScenarioId } from "@macro-nation/domain";
import { loadConfigPack, parseConfigPack } from "./config";

const SCN01_CONFIG_INPUT = {
  manifest,
  coefficients,
  lagKernels,
  shockModel,
  policyRules,
  calibrationTargets,
  sources,
  content,
  model,
  limits,
  effectCurves,
  nation,
  scenario,
};

const SHARED_CONFIG_FILES = Object.freeze({
  "coefficients.json": coefficients,
  "lagKernels.json": lagKernels,
  "shockModel.json": shockModel,
  "policyRules.json": policyRules,
  "calibrationTargets.json": calibrationTargets,
  "sources.json": sources,
  "content.json": content,
  "balanced-v0.1.0.json": model,
  "limits-v1.json": limits,
  "effect-curves-v1.json": effectCurves,
  "standard-nation-v1.json": nation,
});

export const SCN01_CONFIG_FILES = Object.freeze({
  ...SHARED_CONFIG_FILES,
  "scn01-v1.json": scenario,
});

export const SCN01_CONFIG_PACK = parseConfigPack(SCN01_CONFIG_INPUT);

/** Load the fixture only after every file matches the manifest SHA-256 values. */
export function loadSCN01ConfigPack() {
  return loadConfigPack(SCN01_CONFIG_INPUT, SCN01_CONFIG_FILES);
}

const SCN02_CONFIG_INPUT = {
  ...SCN01_CONFIG_INPUT,
  manifest: scn02Manifest,
  scenario: scn02,
};
const SCN03_CONFIG_INPUT = {
  ...SCN01_CONFIG_INPUT,
  manifest: scn03Manifest,
  scenario: scn03,
};
export const SCN02_CONFIG_FILES = Object.freeze({
  ...SHARED_CONFIG_FILES,
  "scn02-v1.json": scn02,
});
export const SCN03_CONFIG_FILES = Object.freeze({
  ...SHARED_CONFIG_FILES,
  "scn03-v1.json": scn03,
});
export const SCN02_CONFIG_PACK = parseConfigPack(SCN02_CONFIG_INPUT);
export const SCN03_CONFIG_PACK = parseConfigPack(SCN03_CONFIG_INPUT);

/** Resolve a scenario's pinned configuration before starting a new game. */
export function loadScenarioConfigPack(scenarioId: ScenarioId) {
  switch (scenarioId) {
    case "SCN-01":
      return loadSCN01ConfigPack();
    case "SCN-02":
      return loadConfigPack(SCN02_CONFIG_INPUT, SCN02_CONFIG_FILES);
    case "SCN-03":
      return loadConfigPack(SCN03_CONFIG_INPUT, SCN03_CONFIG_FILES);
    default:
      throw new Error(`Unsupported scenario ${scenarioId}`);
  }
}
