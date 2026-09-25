import { beforeAll, describe, expect, it } from "vitest";
import {
  createConfigSnapshot,
  loadSCN01ConfigPack,
} from "@macro-nation/model-config";
import type { GameState, VersionTuple } from "@macro-nation/domain";
import {
  ENGINE_VERSION,
  applyPolicyCommand,
  createSCN01InitialState,
  policyStateHash,
  previewCacheKey,
  previewPolicy,
  runNoPolicyHeadless,
  runPolicyHeadless,
  type PolicyDraft,
} from "./index";

let state: GameState;
beforeAll(async () => {
  const pack = await loadSCN01ConfigPack();
  const configSnapshot = await createConfigSnapshot(
    pack,
    pack.scenario.parameterOverrides,
  );
  const versions: VersionTuple = {
    saveSchemaVersion: "1",
    engineVersion: ENGINE_VERSION,
    configSchemaVersion: pack.manifest.configSchemaVersion,
    modelVersion: pack.manifest.modelVersion,
    calibrationVersion: pack.manifest.calibrationVersion,
    contentVersion: pack.manifest.contentVersion,
    rngVersion: pack.manifest.rngVersion,
    configVersion: pack.manifest.configVersion,
  };
  state = createSCN01InitialState({
    configSnapshot,
    versions,
    seed: "preview-golden-v1",
  });
});

const draft: PolicyDraft = {
  status: "draft",
  policyId: "higher-rate",
  ruleId: "interest-rate",
  value: 0.05,
  quartersAhead: 0,
};

describe("paired policy preview", () => {
  it("runs 12/60-month IRFs without touching live state or RNG and is repeatable", () => {
    const original = JSON.stringify(state);
    const input = { state, draft };
    const first = previewPolicy(input);
    expect(JSON.stringify(state)).toBe(original);
    expect(first).toEqual(previewPolicy(input));
    expect(first.configHash).toBe(state.configSnapshot.configHash);
    expect(first.calibrationVersion).toBe(state.versions.calibrationVersion);
    expect(first.summaries).toHaveLength(first.indicators.length * 2);
    expect(first.irf.policyRate).toHaveLength(60);
    expect(first.primaryEffects.length).toBeGreaterThan(0);
    expect(first.previewedDraft?.previewStateHash).toBe(policyStateHash(state));
    expect(first.uncertainty.quantiles).toEqual([0.16, 0.5, 0.84]);
  });

  it("reports ordered ranges, an unchanged baseline, and distinct cache identities", () => {
    const proposal = previewPolicy({ state, draft, horizonMonths: 12 });
    for (const row of proposal.indicators) {
      for (const key of ["month3", "month6", "month12"] as const) {
        expect(row[key].low).toBeLessThanOrEqual(row[key].base);
        expect(row[key].base).toBeLessThanOrEqual(row[key].high);
        expect(row[key].deltaLow).toBeLessThanOrEqual(row[key].deltaBase);
        expect(row[key].deltaBase).toBeLessThanOrEqual(row[key].deltaHigh);
      }
    }
    const noop = previewPolicy({ state, draft: null, horizonMonths: 12 });
    expect(noop.indicators.every((row) => row.month12.deltaBase === 0)).toBe(
      true,
    );
    expect(noop.primaryEffects).toEqual([]);
    expect(proposal.cacheKey).not.toBe(noop.cacheKey);
    expect(previewCacheKey({ state, draft, horizonMonths: 60 })).not.toBe(
      proposal.cacheKey,
    );
    expect(
      previewCacheKey({
        state,
        draft,
        horizonMonths: 12,
        shockPairingId: "alternate",
      }),
    ).not.toBe(proposal.cacheKey);
  });

  it("uses the committed policy response direction and lag from the same model", () => {
    const preview = previewPolicy({ state, draft, horizonMonths: 12 });
    const committed = applyPolicyCommand(state, {
      kind: "commit",
      commandId: "real-commit",
      expectedStateHash: preview.stateHash,
      draft: preview.previewedDraft!,
    }).state;
    const base = runNoPolicyHeadless({ initialState: state, tickCount: 12 });
    const variant = runPolicyHeadless({
      initialState: committed,
      tickCount: 12,
    });
    expect(base.failure).toBeNull();
    expect(variant.failure).toBeNull();
    const realized =
      variant.records[0]!.state.economy.rates.policyRate -
      base.records[0]!.state.economy.rates.policyRate;
    const expected = preview.irf.policyRate[0]!;
    expect(expected).toBeGreaterThan(0);
    expect(realized).toBeCloseTo(expected, 8);
    expect(
      preview.summaries.find((item) => item.indicatorId === "policyRate")
        ?.peakMonth,
    ).toBeGreaterThanOrEqual(1);
  });
});
