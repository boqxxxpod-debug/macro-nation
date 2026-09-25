import { beforeAll, describe, expect, it } from "vitest";
import {
  createConfigSnapshot,
  loadSCN01ConfigPack,
} from "@macro-nation/model-config";
import {
  stockLevel,
  type GameState,
  type VersionTuple,
} from "@macro-nation/domain";
import {
  ENGINE_VERSION,
  activateDuePolicies,
  createConfiguredPolicyRegistry,
  createReservedPolicy,
  createFixedPolicyReplayPackage,
  replayFixedPolicyPackage,
  createSCN01InitialState,
  runNoPolicyHeadless,
  runPolicyHeadless,
  terminateActivePolicy,
} from "./index";

let initial: GameState;
let irfTargets: readonly {
  targetId: string;
  shockId: string;
  indicatorId: string;
  horizonMonths: number;
  min: number;
  max: number;
}[];
beforeAll(async () => {
  const pack = await loadSCN01ConfigPack();
  irfTargets = pack.calibrationTargets.irf;
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
  initial = createSCN01InitialState({
    configSnapshot,
    seed: "paired-policy-v1",
    versions,
  });
});
function withPolicy(id: string, value: number, base = initial) {
  const policy = createReservedPolicy(base, id, value, `${id}-decision`);
  return { ...base, policies: { ...base.policies, reserved: [policy] } };
}
const cases = [
  ["interest-rate", 0.03],
  ["tax-package", 0.01],
  ["public-works", 0.01],
  ["tariff", 0.1],
  ["fx-intervention", 0.01],
] as const;

describe("configured policy runtime", () => {
  it.each(cases)(
    "activates %s with normalized, bounded and attributable scheduled effects",
    (id, value) => {
      const state = withPolicy(id, value);
      const { state: activated, causal } = activateDuePolicies(state);
      expect(activated.policies.reserved).toEqual([]);
      expect(activated.policies.active).toHaveLength(1);
      expect(activated.policies.active[0]).toMatchObject({
        policyId: `${id}-decision`,
        status: "active",
      });
      expect(activated.effects.length).toBeGreaterThan(0);
      expect(
        activated.effects.some((effect) => effect.role === "sideEffect"),
      ).toBe(true);
      for (const effect of activated.effects) {
        expect(effect.sourceId).toBe(`${id}-decision`);
        expect(effect.effectId).toMatch(new RegExp(`^${id}-decision:`));
        expect(effect.weights.length).toBe(
          effect.endMonth - effect.startMonth + 1,
        );
        expect(effect.weights.every((weight) => weight >= 0)).toBe(true);
        expect(
          effect.weights.reduce((sum, weight) => sum + weight, 0),
        ).toBeCloseTo(1, 10);
      }
      for (const entry of causal)
        expect(
          entry.contributions.reduce((sum, x) => sum + x.delta, 0),
        ).toBeCloseTo(entry.totalDelta, 10);
      expect(state.policies.reserved).toHaveLength(1);
      expect(state.effects).toEqual([]);
    },
  );
  it("rejects unregistered policy types at startup", () => {
    const fake = {
      ...initial,
      configSnapshot: {
        ...initial.configSnapshot,
        normalizedConfig: {
          ...initial.configSnapshot.normalizedConfig,
          policyRules: [
            ...(initial.configSnapshot.normalizedConfig
              .policyRules as unknown[]),
            { policyId: "unsupported", policyType: "unknown" },
          ],
        },
      },
    };
    expect(() => createConfiguredPolicyRegistry(fake.configSnapshot)).toThrow(
      /Unsupported policy type/,
    );
  });
  it("pins configured onset, peak and end months for every policy kernel", () => {
    const expected: Record<string, [number, number, number]> = {
      "monetary-fx-0-1-6": [0, 1, 6],
      "monetary-demand-3-15-36": [3, 15, 36],
      "monetary-price-6-21-48": [6, 21, 48],
      "tax-consumption-1-4-18": [1, 4, 18],
      "tax-investment-3-12-36": [3, 12, 36],
      "public-demand-1-6-24": [1, 6, 24],
      "public-capital-12-36-84": [12, 36, 84],
      "tariff-price-0-3-12": [0, 3, 12],
      "tariff-activity-3-12-30": [3, 12, 30],
      "fxi-fx-0-1-12": [0, 1, 12],
    };
    const kernels = initial.configSnapshot.normalizedConfig.lagKernels as {
      kernelId: string;
      start: number;
      peak: number;
      end: number;
      weights: number[];
    }[];
    for (const kernel of kernels) {
      if (!(kernel.kernelId in expected)) continue;
      expect([kernel.start, kernel.peak, kernel.end]).toEqual(
        expected[kernel.kernelId],
      );
      expect(
        kernel.weights.indexOf(Math.max(...kernel.weights)) + kernel.start,
      ).toBe(kernel.peak);
      expect(kernel.weights.every((weight) => weight >= 0)).toBe(true);
      expect(
        kernel.weights.reduce((sum, weight) => sum + weight, 0),
      ).toBeCloseTo(1, 10);
    }
    const fx = kernels.find((kernel) => kernel.kernelId === "fxi-fx-0-1-12")!;
    const halfMonth = fx.weights.findIndex(
      (weight, index) => index > fx.peak && weight <= fx.weights[fx.peak]! / 2,
    );
    expect(halfMonth - fx.peak).toBeGreaterThanOrEqual(2);
    expect(halfMonth - fx.peak).toBeLessThanOrEqual(6);
  });
  it("aligns a future reservation to the next quarter boundary", () => {
    const midQuarter = { ...initial, monthIndex: 1 };
    expect(
      createReservedPolicy(midQuarter, "tax-package", 0.01, "future", 1)
        .activationMonth,
    ).toBe(3);
  });
  it("repeated intervention has less effect with the same reserve balance", () => {
    const old = createReservedPolicy(initial, "fx-intervention", 0.01, "old");
    const repeated = {
      ...initial,
      policies: {
        ...initial.policies,
        completed: [{ ...old, status: "completed" as const }],
      },
    };
    const first = activateDuePolicies(withPolicy("fx-intervention", 0.01));
    const second = activateDuePolicies(
      withPolicy("fx-intervention", 0.01, repeated),
    );
    const strength = (state: GameState) =>
      state.effects.find(
        (effect) => effect.targetPath === "economy.indices.fx",
      )!.baseStrength;
    expect(Math.abs(strength(second.state))).toBeLessThan(
      Math.abs(strength(first.state)),
    );
  });
  it("expires the policy but keeps its delayed effects until their scheduled end", () => {
    const result = runPolicyHeadless({
      initialState: withPolicy("public-works", 0.01),
      tickCount: 48,
    });
    expect(result.failure).toBeNull();
    expect(result.ticksCompleted).toBe(48);
    expect(result.finalState.policies.active).toEqual([]);
    expect(result.finalState.policies.completed).toHaveLength(1);
    expect(result.finalState.effects).toEqual([]);
    expect(result.records[23]!.state.policies.active).toHaveLength(1);
    expect(result.records[24]!.state.policies.completed).toHaveLength(1);
  });
  it("terminates an active policy once, removes future effects and records reversal costs", () => {
    const activated = activateDuePolicies(withPolicy("interest-rate", 0.03));
    const stopped = terminateActivePolicy(
      activated.state,
      "interest-rate-decision",
    );
    expect(stopped.state.policies.active).toEqual([]);
    expect(stopped.state.policies.completed).toMatchObject([
      { status: "terminated" },
    ]);
    expect(stopped.state.effects).toEqual([]);
    expect(stopped.state.economy.rates.policyRate).toBe(
      initial.economy.rates.policyRate,
    );
    expect(stopped.state.resources.politicalCapital).toBe(
      activated.state.resources.politicalCapital - 1,
    );
    expect(stopped.state.economy.sentiment.policyTrust).toBeLessThan(
      activated.state.economy.sentiment.policyTrust,
    );
    for (const entry of stopped.causal)
      expect(
        entry.contributions.reduce((sum, part) => sum + part.delta, 0),
      ).toBeCloseTo(entry.totalDelta, 10);
    expect(() =>
      terminateActivePolicy(stopped.state, "interest-rate-decision"),
    ).toThrow(/No active policy/);
  });
  it("low reserves weaken FX intervention while costs remain accountable", () => {
    const low = {
      ...initial,
      economy: {
        ...initial.economy,
        stocks: { ...initial.economy.stocks, foreignReserves: stockLevel(50) },
      },
    };
    const high = activateDuePolicies(withPolicy("fx-intervention", 0.01));
    const constrained = activateDuePolicies(
      withPolicy("fx-intervention", 0.01, low),
    );
    const primary = (state: GameState) =>
      state.effects.find((effect) => effect.role === "primary")!.baseStrength;
    expect(Math.abs(primary(constrained.state))).toBeLessThan(
      Math.abs(primary(high.state)),
    );
    expect(high.state.economy.stocks.foreignReserves).toBe(
      initial.economy.stocks.foreignReserves - 12,
    );
    expect(constrained.state.economy.stocks.foreignReserves).toBe(38);
  });
  it("replays a serialized fixed-policy package exactly and rejects version drift", () => {
    const state = withPolicy("tax-package", 0.01);
    const expected = runPolicyHeadless({ initialState: state, tickCount: 24 });
    const serialized = JSON.parse(
      JSON.stringify(createFixedPolicyReplayPackage(state, 24)),
    );
    expect(replayFixedPolicyPackage(serialized)).toEqual(expected);
    expect(() =>
      replayFixedPolicyPackage({ ...serialized, engineVersion: "99.0.0" }),
    ).toThrow(/does not match/);
    expect(() =>
      replayFixedPolicyPackage({ ...serialized, commands: [] }),
    ).toThrow(/commands do not match/);
  });
  it("pairs all five policies against the same no-policy seed and checks direction, lag and causality", () => {
    const baseline = runNoPolicyHeadless({
      initialState: initial,
      tickCount: 48,
    });
    expect(baseline.failure).toBeNull();
    const results = Object.fromEntries(
      cases.map(([id, value]) => [
        id,
        runPolicyHeadless({
          initialState: withPolicy(id, value),
          tickCount: 48,
        }),
      ]),
    );
    for (const result of Object.values(results)) {
      expect(result.failure).toBeNull();
      expect(result.ticksCompleted).toBe(48);
      for (const record of result.records)
        for (const entry of record.diagnostics.causal) {
          expect(
            entry.contributions.reduce((sum, x) => sum + x.delta, 0),
          ).toBeCloseTo(entry.totalDelta, 8);
        }
    }
    const at = (id: string, month: number) =>
      results[id]!.records[month - 1]!.state.economy;
    const base = (month: number) => baseline.records[month - 1]!.state.economy;
    expect(at("interest-rate", 3).indices.realGdp).toBeLessThan(
      base(3).indices.realGdp,
    );
    expect(at("interest-rate", 24).rates.unemployment).toBeGreaterThan(
      base(24).rates.unemployment,
    );
    expect(at("interest-rate", 24).indices.cpi).toBeLessThan(
      base(24).indices.cpi,
    );
    expect(at("tax-package", 12).indices.realGdp).toBeLessThan(
      base(12).indices.realGdp,
    );
    expect(at("tax-package", 12).flows.taxRevenue).toBeGreaterThan(
      base(12).flows.taxRevenue,
    );
    expect(at("public-works", 12).indices.realGdp).toBeGreaterThan(
      base(12).indices.realGdp,
    );
    expect(at("public-works", 48).indices.potentialGdp).toBeGreaterThan(
      base(48).indices.potentialGdp,
    );
    expect(at("tariff", 3).indices.importPrice).toBeGreaterThan(
      base(3).indices.importPrice,
    );
    expect(at("tariff", 12).flows.imports).toBeLessThan(base(12).flows.imports);
    expect(at("fx-intervention", 6).indices.fx).toBeLessThan(
      base(6).indices.fx,
    );
    expect(at("fx-intervention", 1).stocks.foreignReserves).toBeLessThan(
      base(1).stocks.foreignReserves,
    );
    const named: Record<string, string> = {
      "policy-rate-plus-100bp": "interest-rate",
      "public-investment-plus-1pct-gdp-12m": "public-works",
    };
    const relative = (
      id: string,
      month: number,
      key: "realGdp" | "potentialGdp" | "fx",
    ) => at(id, month).indices[key] / base(month).indices[key] - 1;
    for (const target of irfTargets) {
      const id = named[target.shockId];
      if (!id) continue;
      const value =
        target.indicatorId === "unemployment"
          ? at(id, target.horizonMonths).rates.unemployment -
            base(target.horizonMonths).rates.unemployment
          : relative(
              id,
              target.horizonMonths,
              target.indicatorId as "realGdp" | "potentialGdp" | "fx",
            );
      expect(value, target.targetId).toBeGreaterThanOrEqual(target.min);
      expect(value, target.targetId).toBeLessThanOrEqual(target.max);
    }
    const monthOf = (
      id: string,
      metric: "realGdp" | "unemployment",
      months: number,
    ) => {
      const differences = results[id]!.records.slice(0, months).map(
        (row, index) =>
          metric === "realGdp"
            ? row.state.economy.indices.realGdp -
              base(index + 1).indices.realGdp
            : row.state.economy.rates.unemployment -
              base(index + 1).rates.unemployment,
      );
      const peak =
        metric === "realGdp"
          ? Math.min(...differences)
          : Math.max(...differences);
      return differences.indexOf(peak) + 1;
    };
    expect(monthOf("interest-rate", "realGdp", 36)).toBeGreaterThanOrEqual(18);
    expect(monthOf("interest-rate", "realGdp", 36)).toBeLessThanOrEqual(24);
    expect(monthOf("interest-rate", "unemployment", 36)).toBeGreaterThanOrEqual(
      15,
    );
    expect(monthOf("interest-rate", "unemployment", 36)).toBeLessThanOrEqual(
      24,
    );
    const tariffPassThrough =
      (at("tariff", 3).indices.importPrice / base(3).indices.importPrice - 1) /
      0.1;
    expect(tariffPassThrough).toBeGreaterThanOrEqual(0.5);
    expect(tariffPassThrough).toBeLessThanOrEqual(1);
    expect(relative("fx-intervention", 6, "fx")).toBeLessThan(-0.002);
    expect(relative("fx-intervention", 6, "fx")).toBeGreaterThan(-0.015);
    expect(relative("tax-package", 12, "realGdp")).toBeLessThan(-0.001);
    expect(relative("tax-package", 12, "realGdp")).toBeGreaterThan(-0.005);
  });
});
