import { describe, expect, it } from "vitest";

import {
  SCN01_CONFIG_FILES,
  SCN01_CONFIG_PACK,
  assertConfigCompatibility,
  assertEngineCompatibility,
  createConfigSnapshot,
  createSnapshotIndicatorRegistry,
  normalizeParameters,
  parseConfigPack,
  verifyConfigPackHashes,
} from "./index";

describe("ConfigPack v1", () => {
  it("validates the standard SCN-01 fixture and hashes", async () => {
    expect(SCN01_CONFIG_PACK.manifest.modelVersion).toBe("0.1.0");
    expect(SCN01_CONFIG_PACK.scenario.clock.policyCycleSteps).toBe(3);
    await expect(
      verifyConfigPackHashes(SCN01_CONFIG_PACK, SCN01_CONFIG_FILES),
    ).resolves.toBeUndefined();
    expect(() => assertEngineCompatibility(SCN01_CONFIG_PACK, "0.1.0")).not.toThrow();
    expect(() =>
      assertConfigCompatibility(SCN01_CONFIG_PACK, {
        engineVersion: "0.1.0",
        configSchemaVersion: "1",
        modelVersion: "0.1.0",
        calibrationVersion: "advanced-small-open-v1.0.0",
        contentVersion: "1.0.0",
        rngVersion: "xoshiro128ss-v1",
      }),
    ).not.toThrow();
  });

  it("applies defaults, calibration, then scenario overrides", () => {
    const values = normalizeParameters(SCN01_CONFIG_PACK, [
      { parameterId: "EXT-GROW-001", value: 0.03 },
    ]);
    expect(values["EXT-GROW-001"]).toBe(0.025);
  });

  it("rejects incompatible versions", () => {
    expect(() =>
      assertConfigCompatibility(SCN01_CONFIG_PACK, {
        engineVersion: "0.1.0",
        configSchemaVersion: "2",
        modelVersion: "0.1.0",
        calibrationVersion: "advanced-small-open-v1.0.0",
        contentVersion: "1.0.0",
        rngVersion: "xoshiro128ss-v1",
      }),
    ).toThrow(/configSchemaVersion/);
  });

  it("rejects non-allowlisted or out-of-range overrides", () => {
    expect(() =>
      normalizeParameters(
        SCN01_CONFIG_PACK,
        [{ parameterId: "CONS-Y-001", value: 0.7 }],
        [],
      ),
    ).toThrow(/not allowed/);
    expect(() =>
      normalizeParameters(
        SCN01_CONFIG_PACK,
        [],
        [{ parameterId: "EXT-GROW-001", value: 0.5 }],
      ),
    ).toThrow(/out of range/);
  });

  it("freezes a versioned snapshot with parameter metadata and SHA-256 identity", async () => {
    const snapshot = await createConfigSnapshot(SCN01_CONFIG_PACK);
    expect(snapshot.configHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.sourceManifest[0]?.sourceId).toBe("econ-model-v1");
    expect(Object.isFrozen(snapshot.normalizedConfig)).toBe(true);
    expect(
      (snapshot.normalizedConfig.parameterDefinitions as unknown[]).length,
    ).toBeGreaterThan(20);
  });

  it("rejects duplicate IDs, invalid correlations and circular references", () => {
    const broken = structuredClone({
      manifest: SCN01_CONFIG_PACK.manifest,
      coefficients: SCN01_CONFIG_PACK.coefficients,
      lagKernels: SCN01_CONFIG_PACK.lagKernels,
      shockModel: SCN01_CONFIG_PACK.shockModel,
      policyRules: SCN01_CONFIG_PACK.policyRules,
      calibrationTargets: SCN01_CONFIG_PACK.calibrationTargets,
      sources: SCN01_CONFIG_PACK.sources,
      content: SCN01_CONFIG_PACK.content,
      model: SCN01_CONFIG_PACK.model,
      limits: SCN01_CONFIG_PACK.limits,
      effectCurves: SCN01_CONFIG_PACK.effectCurves,
      nation: SCN01_CONFIG_PACK.nation,
      scenario: SCN01_CONFIG_PACK.scenario,
    });
    broken.content.policies.push(broken.content.policies[0]!);
    expect(() => parseConfigPack(broken)).toThrow(/Duplicate policy ID/);

    const correlationBroken = structuredClone(broken);
    correlationBroken.content.policies.pop();
    correlationBroken.shockModel.correlation = [
      [1, 2, 0],
      [2, 1, 0],
      [0, 0, 1],
    ];
    expect(() => parseConfigPack(correlationBroken)).toThrow(/positive definite|Cholesky/);

    const circular = structuredClone(correlationBroken);
    circular.shockModel = structuredClone(SCN01_CONFIG_PACK.shockModel);
    circular.content.events[0]!.dependsOn = [circular.content.events[0]!.eventId];
    expect(() => parseConfigPack(circular)).toThrow(/Circular event reference/);

    const missingVersion = structuredClone(circular) as Record<string, unknown>;
    missingVersion.content = structuredClone(SCN01_CONFIG_PACK.content);
    missingVersion.manifest = { ...SCN01_CONFIG_PACK.manifest, modelVersion: "" };
    expect(() => parseConfigPack(missingVersion as never)).toThrow();

    const forbiddenOverride = structuredClone({
      manifest: SCN01_CONFIG_PACK.manifest,
      coefficients: SCN01_CONFIG_PACK.coefficients,
      lagKernels: SCN01_CONFIG_PACK.lagKernels,
      shockModel: SCN01_CONFIG_PACK.shockModel,
      policyRules: SCN01_CONFIG_PACK.policyRules,
      calibrationTargets: SCN01_CONFIG_PACK.calibrationTargets,
      sources: SCN01_CONFIG_PACK.sources,
      content: SCN01_CONFIG_PACK.content,
      model: SCN01_CONFIG_PACK.model,
      limits: SCN01_CONFIG_PACK.limits,
      effectCurves: SCN01_CONFIG_PACK.effectCurves,
      nation: SCN01_CONFIG_PACK.nation,
      scenario: SCN01_CONFIG_PACK.scenario,
    });
    forbiddenOverride.scenario.parameterOverrides = [
      { parameterId: "CONS-Y-001", value: 0.7 },
    ];
    expect(() => parseConfigPack(forbiddenOverride)).toThrow(/override not allowed/);
  });
  it("requires a definition for every new indicator and accepts a named-input policy", () => {
    expect(() => parseConfigPack({
      ...SCN01_CONFIG_PACK,
      policyRules: SCN01_CONFIG_PACK.policyRules.slice(0, -1),
    })).toThrow(/Missing policy rule/);
    const content = {
      ...SCN01_CONFIG_PACK.content,
      indicators: [
        ...SCN01_CONFIG_PACK.content.indicators,
        "youthUnemployment",
      ],
    };
    expect(() => parseConfigPack({ ...SCN01_CONFIG_PACK, content })).toThrow(
      /Missing indicator definition/,
    );
    const withIndicator = {
      ...content,
      textKeys: [...content.textKeys, "indicator.youthUnemployment"],
      indicatorDefinitions: [
        ...(content.indicatorDefinitions ?? []),
        {
          indicatorId: "youthUnemployment",
          labelKey: "indicator.youthUnemployment",
          unit: "PercentRate",
          source: { kind: "statePath", path: "economy.rates.unemployment" },
        },
      ],
    };
    expect(() =>
      parseConfigPack({ ...SCN01_CONFIG_PACK, content: withIndicator }),
    ).not.toThrow();
    const policyRules = [
      ...SCN01_CONFIG_PACK.policyRules,
      {
        policyId: "housing-tax",
        policyType: "housingTax",
        inputs: [
          {
            inputId: "rate",
            labelKey: "policy.housing.rate",
            unit: "PercentRate",
            min: 0,
            max: 0.2,
            defaultValue: 0.05,
            step: 0.01,
          },
        ],
        costs: {
          politicalCapital: 1,
          implementationCapacity: 1,
          foreignReserves: 0,
          immediateBudget: 0,
        },
        regimeModifiers: { normal: 1 },
        caps: { maxMonthlyDelta: 0.02 },
      },
    ];
    expect(() =>
      parseConfigPack({
        ...SCN01_CONFIG_PACK,
        policyRules,
        content: {
          ...SCN01_CONFIG_PACK.content,
          policies: [...SCN01_CONFIG_PACK.content.policies, "housing-tax"],
          textKeys: [
            ...SCN01_CONFIG_PACK.content.textKeys,
            "policy.housing.rate",
          ],
        },
      }),
    ).not.toThrow();
    const offStep = structuredClone(policyRules);
    offStep[offStep.length - 1]!.inputs![0]!.defaultValue = 0.055;
    expect(() => parseConfigPack({
      ...SCN01_CONFIG_PACK,
      policyRules: offStep,
      content: { ...SCN01_CONFIG_PACK.content,
        policies: [...SCN01_CONFIG_PACK.content.policies, "housing-tax"],
        textKeys: [...SCN01_CONFIG_PACK.content.textKeys, "policy.housing.rate"],
      },
    })).toThrow(/default is not on step/);
  });

  it("reads indicators from the saved snapshot, even after the published pack changes", async () => {
    const oldSnapshot = await createConfigSnapshot(SCN01_CONFIG_PACK);
    const oldRegistry = createSnapshotIndicatorRegistry(oldSnapshot);
    expect(oldRegistry.definitions).toHaveLength(
      SCN01_CONFIG_PACK.content.indicators.length,
    );
    const newerContent = {
      ...SCN01_CONFIG_PACK.content,
      indicators: [
        ...SCN01_CONFIG_PACK.content.indicators,
        "youthUnemployment",
      ],
      textKeys: [
        ...SCN01_CONFIG_PACK.content.textKeys,
        "indicator.youthUnemployment",
      ],
      indicatorDefinitions: [
        ...(SCN01_CONFIG_PACK.content.indicatorDefinitions ?? []),
        {
          indicatorId: "youthUnemployment",
          labelKey: "indicator.youthUnemployment",
          unit: "PercentRate" as const,
          source: {
            kind: "statePath" as const,
            path: "economy.rates.unemployment",
          },
        },
      ],
    };
    const newPack = parseConfigPack({
      ...SCN01_CONFIG_PACK,
      content: newerContent,
    });
    const newSnapshot = await createConfigSnapshot(newPack);
    expect(
      createSnapshotIndicatorRegistry(newSnapshot).definitions,
    ).toHaveLength(SCN01_CONFIG_PACK.content.indicators.length + 1);
    expect(
      createSnapshotIndicatorRegistry(oldSnapshot).definitions,
    ).toHaveLength(SCN01_CONFIG_PACK.content.indicators.length);
    expect(oldSnapshot.configHash).not.toBe(newSnapshot.configHash);
  });
});
