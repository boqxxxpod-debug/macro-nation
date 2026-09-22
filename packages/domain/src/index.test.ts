import { describe, expect, it } from "vitest";

import {
  assertReplayIdentity,
  canTransitionRunState,
  flowPerMonth,
  indexLevel,
  percentPoint,
  percentRate,
  share01,
  stockLevel,
  validateState,
  type EconomyState,
  type GameState,
} from "./index";

function economy(): EconomyState {
  const industries = Object.fromEntries(
    [
      "agricultureResources",
      "manufacturing",
      "construction",
      "householdServices",
      "financeRealEstate",
      "energyLogistics",
    ].map((id) => [
      id,
      {
        productionIndex: indexLevel(100),
        employmentShare: share01(1 / 6),
        capacityIndex: indexLevel(100),
        importDependency: share01(0.2),
        priceIndex: indexLevel(100),
      },
    ]),
  ) as EconomyState["industries"];

  return {
    indices: {
      realGdp: indexLevel(100),
      cpi: indexLevel(100),
      fx: indexLevel(100),
      nominalWage: indexLevel(100),
      realHouseholdIncome: indexLevel(100),
      potentialGdp: indexLevel(100),
      importPrice: indexLevel(100),
    },
    rates: {
      unemployment: percentRate(0.05),
      policyRate: percentRate(0.02),
      marketRate: percentRate(0.025),
      expectedInflation: percentRate(0.02),
      foreignRate: percentRate(0.025),
    },
    gaps: {
      yGap: percentPoint(0),
      rGap: percentPoint(0),
      uGap: percentPoint(0),
    },
    flows: {
      consumption: flowPerMonth(60),
      investment: flowPerMonth(18),
      governmentConsumption: flowPerMonth(20),
      publicInvestment: flowPerMonth(0),
      exports: flowPerMonth(25),
      imports: flowPerMonth(23),
      taxRevenue: flowPerMonth(25),
      primarySpending: flowPerMonth(24),
      interestPayment: flowPerMonth(1),
      currentAccount: flowPerMonth(2),
      capitalFlow: flowPerMonth(0),
    },
    stocks: {
      governmentDebt: stockLevel(1080),
      governmentDebtDomestic: stockLevel(800),
      governmentDebtForeign: stockLevel(280),
      foreignReserves: stockLevel(300),
    },
    sentiment: {
      consumerConfidence: indexLevel(60),
      businessConfidence: indexLevel(60),
      policyTrust: indexLevel(60),
      support: indexLevel(55),
      inequality: indexLevel(35),
      speculationPressure: indexLevel(20),
    },
    institutions: {
      politicalCapital: indexLevel(60),
      implementationCapacity: indexLevel(70),
      centralBankIndependence: indexLevel(80),
      taxCapacity: indexLevel(75),
      procurementTransparency: indexLevel(75),
    },
    industries,
    infrastructure: { transport: indexLevel(100) },
    external: {
      foreignGrowthAnnual: percentRate(0.025),
      foreignRate: percentRate(0.025),
      resourcePriceIndex: indexLevel(100),
      partnerRelation: indexLevel(60),
      disasterRisk: share01(0.1),
    },
    logs: { fxLogIndex: 0 as EconomyState["logs"]["fxLogIndex"] },
  };
}

function state(): GameState {
  const e = economy();
  return {
    gameId: "g1",
    slotId: 1,
    nationId: "standard-nation",
    scenarioId: "SCN-01",
    difficulty: "standard",
    monthIndex: 0,
    tickSequence: 0,
    runState: "running",
    economy: e,
    policies: { active: [], reserved: [], completed: [], cancelled: [] },
    effects: [],
    events: { activeEventIds: [] },
    resources: {
      politicalCapital: indexLevel(60),
      implementationCapacity: indexLevel(70),
      foreignReserves: e.stocks.foreignReserves,
      discretionaryBudget: flowPerMonth(10),
    },
    rng: { rootSeed: "seed", rngVersion: "xoshiro128ss-v1", streams: {} },
    crisisCounters: {},
    history: { entries: [] },
    clock: {
      gameClock: { stepIndex: 0, calendarYear: 2026, calendarMonth: 1 },
      config: {
        simulationStep: "month",
        policyCycleSteps: 3,
        realSecondsPerStep: 300,
        offlineMaxSteps: 24,
      },
    },
    versions: {
      saveSchemaVersion: "1",
      engineVersion: "1.0.0",
      modelVersion: "0.1.0",
      configSchemaVersion: "1.0.0",
      calibrationVersion: "advanced-small-open-v1.0.0",
      contentVersion: "1.0.0",
      rngVersion: "xoshiro128ss-v1",
      configVersion: "0.1.0",
    },
    configSnapshot: {
      configHash: "abc",
      sourceManifest: ["src-1"],
      versions: {
        engineVersion: "1.0.0",
        modelVersion: "0.1.0",
        configSchemaVersion: "1.0.0",
        calibrationVersion: "advanced-small-open-v1.0.0",
        contentVersion: "1.0.0",
      },
      payload: {},
    },
  };
}

describe("domain invariants", () => {
  it("accepts the minimal valid state", () => {
    expect(validateState(state())).toEqual([]);
  });

  it.each([
    ["unemployment below clamp", (s: GameState) => ({ ...s, economy: { ...s.economy, rates: { ...s.economy.rates, unemployment: percentRate(0.019) } } })],
    ["policy rate above clamp", (s: GameState) => ({ ...s, economy: { ...s.economy, rates: { ...s.economy.rates, policyRate: percentRate(0.301) } } })],
    ["fx below clamp", (s: GameState) => ({ ...s, economy: { ...s.economy, indices: { ...s.economy.indices, fx: indexLevel(19) } } })],
  ])("rejects %s", (_name, mutate) => {
    expect(validateState(mutate(state())).length).toBeGreaterThan(0);
  });

  it("rejects NaN, debt mismatch, duplicate policies, reversed history and broken weights", () => {
    const base = state();
    const policy = {
      policyId: "P1",
      type: "interestRate" as const,
      decidedMonth: 0,
      activationMonth: 0,
      status: "active" as const,
      slotQuarter: 0,
      costs: { politicalCapital: 0, implementationCapacity: 0, foreignReserves: 0, immediateBudget: 0 },
      sourceCommandId: "cmd",
      parameters: {},
    };
    const broken: GameState = {
      ...base,
      economy: {
        ...base.economy,
        indices: { ...base.economy.indices, cpi: indexLevel(Number.NaN) },
        stocks: { ...base.economy.stocks, governmentDebt: stockLevel(999) },
      },
      policies: { ...base.policies, active: [policy], completed: [policy] },
      effects: [{
        effectId: "E1",
        sourceType: "policy",
        sourceId: "P1",
        targetPath: "economy.indices.realGdp",
        operation: "addDelta",
        startMonth: 0,
        endMonth: 1,
        curveId: "bad",
        weights: [0.4, 0.4],
        baseStrength: 1,
        modifierIds: [],
        uncertainty: { low: 0, high: 0 },
        role: "primary",
        labelKey: "effect",
      }],
      history: { entries: [{ monthIndex: 2, snapshotId: "a" }, { monthIndex: 1, snapshotId: "b" }] },
    };
    const codes = validateState(broken).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      "NOT_FINITE",
      "DEBT_COMPONENT_MISMATCH",
      "POLICY_ID_DUPLICATE",
      "EFFECT_WEIGHT_MISMATCH",
      "HISTORY_ORDER",
    ]));
  });

  it("makes completed and failed terminal states", () => {
    expect(canTransitionRunState("completed", "running")).toBe(false);
    expect(canTransitionRunState("failed", "paused")).toBe(false);
    expect(canTransitionRunState("completed", "completed")).toBe(true);
  });

  it("treats replay hash/version mismatch as a hard error", () => {
    expect(() =>
      assertReplayIdentity(
        {
          versions: {
            engineVersion: "1",
            configSchemaVersion: "1",
            calibrationVersion: "a",
            contentVersion: "1",
            rngVersion: "r",
          },
          configHash: "hash-a",
        },
        {
          versions: {
            engineVersion: "1",
            configSchemaVersion: "1",
            calibrationVersion: "a",
            contentVersion: "1",
            rngVersion: "r",
          },
          configHash: "hash-b",
        },
      ),
    ).toThrow(/non-reproducible/);
  });
});
