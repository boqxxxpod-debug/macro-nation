import { describe, expect, it } from "vitest";

import {
  SCN01_CONFIG_FILES,
  SCN01_CONFIG_PACK,
  assertEngineCompatibility,
  createConfigSnapshot,
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
  });

  it("applies defaults, calibration, then scenario overrides", () => {
    const values = normalizeParameters(SCN01_CONFIG_PACK, [
      { parameterId: "EXT-GROW-001", value: 0.03 },
    ]);
    expect(values["EXT-GROW-001"]).toBe(0.025);
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
  });
});
