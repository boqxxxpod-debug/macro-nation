import { describe, expect, it } from "vitest";

import {
  ConfigValidationError,
  mergeConfigLayers,
  validateConfigPack,
} from "./index";
import type { ConfigPack } from "./index";

function validPack(): ConfigPack {
  return {
    manifest: {
      configPackId: "test",
      configSchemaVersion: "1.0.0",
      engineCompatibility: { min: "1.0.0", maxExclusive: "2.0.0" },
      modelVersion: "0.1.0",
      calibrationVersion: "advanced-small-open-v1.0.0",
      contentVersion: "1.0.0",
      files: { "x.json": "a".repeat(64) },
      overrideAllowlist: ["parameters.alpha"],
      sourceManifest: ["SRC"],
    },
    coefficients: {
      modelVersion: "0.1.0",
      parameters: [{
        parameterId: "P",
        description: "parameter",
        unit: "Ratio",
        default: 1,
        min: 0,
        max: 2,
        evidenceClass: "C",
        sourceIds: ["SRC"],
        rangeKind: "tuning",
      }],
    },
    lagKernels: {
      kernels: [{ id: "instant", start: 0, peak: 0, end: 0, shape: "instant", weights: [1] }],
    },
    shockModel: {
      factors: [{ id: "a", persistence: 0.8, shockStd: 0.1 }],
      correlationMatrix: [[1]],
      regimes: [{ id: "normal", multiplier: 1 }],
    },
    policyRules: {
      rules: [{ id: "policy", parameterIds: ["P"], lagKernelIds: ["instant"], inputScale: 1, maxAbsoluteInput: 1 }],
    },
    calibrationTargets: { targets: [] },
    sources: {
      sources: [{ id: "SRC", citation: "source", accessedAt: "2026-09-22", confidence: "medium", notes: "" }],
    },
    nations: [{
      nationId: "n",
      displayNameKey: "n",
      population: 1,
      industryShares: {
        agricultureResources: 1 / 6,
        manufacturing: 1 / 6,
        construction: 1 / 6,
        householdServices: 1 / 6,
        financeRealEstate: 1 / 6,
        energyLogistics: 1 / 6,
      },
      initial: {
        realGdp: 100,
        cpi: 100,
        fx: 100,
        unemployment: 0.05,
        policyRate: 0.02,
        governmentDebt: 100,
        foreignReserves: 100,
        policyTrust: 60,
        support: 55,
      },
      visualThemeKey: "standard",
    }],
    scenarios: [{
      id: "SCN-01",
      nationId: "n",
      durationMonths: 48,
      clock: { simulationStep: "month", policyCycleSteps: 3, realSecondsPerStep: 300, offlineMaxSteps: 24 },
      initialOverrides: {},
      enabledPolicyRuleIds: ["policy"],
      indicatorIds: ["realGdp"],
    }],
    content: {
      contentVersion: "1.0.0",
      indicators: [{ id: "realGdp", labelKey: "realGdp" }],
      policyIds: ["policy"],
      eventIds: [],
    },
    limits: { hard: { score: [0, 100] }, scenarioUi: {} },
    effectCurves: { curveIds: ["instant"] },
  };
}

describe("ConfigPack validation", () => {
  it("accepts a coherent pack", () => {
    expect(validateConfigPack(validPack())).toEqual(validPack());
  });

  it("rejects broken references, orphan evidence and invalid correlation matrices", () => {
    const pack = validPack();
    const broken = {
      ...pack,
      policyRules: {
        rules: [{ ...pack.policyRules.rules[0]!, parameterIds: ["MISSING"] }],
      },
      sources: {
        sources: [...pack.sources.sources, { id: "ORPHAN", citation: "x", accessedAt: "2026-09-22", confidence: "low" as const, notes: "" }],
      },
      shockModel: {
        ...pack.shockModel,
        factors: [
          { id: "a", persistence: 0.8, shockStd: 0.1 },
          { id: "b", persistence: 0.8, shockStd: 0.1 },
        ],
        correlationMatrix: [[1, 2], [2, 1]],
      },
    };
    expect(() => validateConfigPack(broken)).toThrow(ConfigValidationError);
  });

  it("rejects a lag kernel whose weights do not sum to one", () => {
    const pack = validPack();
    const broken = {
      ...pack,
      lagKernels: {
        kernels: [{ id: "instant", start: 0, peak: 0, end: 0, shape: "instant" as const, weights: [0.9] }],
      },
    };
    expect(() => validateConfigPack(broken)).toThrow(/sum to 1/);
  });

  it("applies config layers only through the override allowlist", () => {
    expect(
      mergeConfigLayers(
        { parameters: { alpha: 1 } },
        { "parameters.alpha": 2 },
        { "parameters.alpha": 3 },
        ["parameters.alpha"],
      ),
    ).toEqual({ parameters: { alpha: 3 } });

    expect(() =>
      mergeConfigLayers({ parameters: { alpha: 1 } }, { "parameters.beta": 2 }, {}, ["parameters.alpha"]),
    ).toThrow(/not allowlisted/);
  });
});
