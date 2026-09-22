import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLOCK_CONFIG,
  flowPerMonth,
  indexLevel,
  percentRate,
  scorePoint,
  share01,
  stockLevel,
  type EconomyState,
  type GameState,
  type IndustryId,
} from "@macro-nation/domain";
import {
  ENGINE_VERSION,
  TICK_EXTENSION_POINTS,
  TICK_STAGE_ORDER,
  XOSHIRO_TICK_RNG_PROVIDER,
  createRngBundle,
  tick,
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
  ) as Record<IndustryId, EconomyState["industries"][IndustryId]>;

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
      inflationAnnual: percentRate(0.02),
      unemployment: percentRate(0.05),
      policyRate: percentRate(0.02),
      marketRate: percentRate(0.025),
      expectedInflation: percentRate(0.02),
      foreignRate: percentRate(0.025),
    },
    ratios: {
      governmentDebtRatio: percentRate(0.9),
      fiscalBalanceRatio: percentRate(-0.03),
    },
    flows: {
      consumption: flowPerMonth(60),
      investment: flowPerMonth(18),
      governmentConsumption: flowPerMonth(20),
      publicInvestment: flowPerMonth(4),
      exports: flowPerMonth(25),
      imports: flowPerMonth(23),
      taxRevenue: flowPerMonth(28),
      primarySpending: flowPerMonth(30),
      interestPayment: flowPerMonth(2),
      currentAccount: flowPerMonth(2),
      capitalFlow: flowPerMonth(0),
    },
    stocks: {
      governmentDebt: stockLevel(1080),
      domesticGovernmentDebt: stockLevel(800),
      externalGovernmentDebt: stockLevel(280),
      foreignReserves: stockLevel(300),
    },
    sentiment: {
      consumerConfidence: scorePoint(50),
      businessConfidence: scorePoint(50),
      policyTrust: scorePoint(60),
      support: scorePoint(55),
      inequality: scorePoint(40),
      speculationPressure: scorePoint(20),
    },
    institutions: {
      politicalCapital: scorePoint(60),
      implementationCapacity: scorePoint(65),
      centralBankIndependence: scorePoint(80),
      taxCapacity: scorePoint(70),
      procurementTransparency: scorePoint(70),
    },
    industries,
    infrastructure: {
      transport: indexLevel(100),
      energy: indexLevel(100),
      digital: indexLevel(100),
      water: indexLevel(100),
      publicFacilities: indexLevel(100),
    },
    external: {
      foreignGrowthAnnual: percentRate(0.025),
      foreignRateAnnual: percentRate(0.025),
      resourcePriceIndex: indexLevel(100),
      partnerRelations: scorePoint(60),
      disasterAlert: scorePoint(20),
      fxShockLogIndex: 0 as EconomyState["external"]["fxShockLogIndex"],
    },
  };
}

function state(month = 1, year = 2026, monthIndex = 0): GameState {
  return {
    gameId: "g1",
    slotId: 1,
    nationId: "standard-nation-v1",
    scenarioId: "SCN-01",
    difficulty: "standard",
    monthIndex,
    tickSequence: monthIndex,
    runState: "running",
    economy: economy(),
    policies: { active: [], reserved: [], completed: [], cancelled: [] },
    effects: [],
    events: { activeEventIds: [], cooldownUntilMonth: {} },
    resources: {
      politicalCapital: scorePoint(60),
      implementationCapacity: scorePoint(65),
      discretionaryBudget: stockLevel(50),
      reservedForeignReserves: stockLevel(0),
    },
    rng: createRngBundle("seed", ["external.global"]),
    crisisCounters: {},
    history: { snapshotMonths: [] },
    clock: {
      stepIndex: monthIndex,
      year,
      month,
      config: DEFAULT_CLOCK_CONFIG,
    },
    versions: {
      saveSchemaVersion: "1",
      engineVersion: ENGINE_VERSION,
      configSchemaVersion: "1",
      modelVersion: "0.1.0",
      calibrationVersion: "advanced-small-open-v1.0.0",
      contentVersion: "1",
      rngVersion: "xoshiro128ss-v1",
      configVersion: "0.1.0",
    },
    configSnapshot: {
      snapshotVersion: "1",
      configHash: "a".repeat(64),
      sourceManifest: [],
      normalizedConfig: {},
    },
  };
}

function run(inputState: GameState, overrides: Partial<Parameters<typeof tick>[0]> = {}) {
  return tick({
    state: inputState,
    expectedTickSequence: inputState.tickSequence,
    clockConfig: inputState.clock.config,
    configSnapshot: inputState.configSnapshot,
    rngProvider: XOSHIRO_TICK_RNG_PROVIDER,
    ...overrides,
  });
}

describe("atomic monthly tick", () => {
  it("keeps the 14 stages fixed and returns identical output for identical input", () => {
    const input = state();
    const first = run(input);
    const second = run(input);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.diagnostics.stageTrace).toEqual(TICK_STAGE_ORDER);
    expect(first.value.state.tickSequence).toBe(1);
    expect(first.value.state.monthIndex).toBe(1);
  });

  it("returns the exact input state and no partial draft when a stage throws", () => {
    const input = state();
    const result = run(input, {
      handlers: {
        updateDemand: ({ state: working }) => {
          (working.economy.sentiment as { support: number }).support = 99;
          throw new Error("demand failed");
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ENGINE_TICK_FAILED");
    expect(result.error.stage).toBe("updateDemand");
    expect(result.state).toBe(input);
    expect(input.economy.sentiment.support).toBe(55);
    expect(input.tickSequence).toBe(0);
  });

  it("rejects stale duplicate tick attempts", () => {
    const input = state();
    const result = run(input, { expectedTickSequence: input.tickSequence - 1 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STALE_TICK_SEQUENCE");
    expect(result.state).toBe(input);
  });

  it("crosses the December boundary atomically", () => {
    const input = state(12, 2026, 11);
    const result = run(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.clock).toMatchObject({
      stepIndex: 12,
      year: 2027,
      month: 1,
    });
    expect(result.value.state.monthIndex).toBe(12);
    expect(result.value.state.tickSequence).toBe(12);
  });

  it("isolates the caller state even when a handler mutates the working draft", () => {
    const input = state();
    const result = run(input, {
      handlers: {
        updateDemand: ({ state: working }) => {
          (working.economy.sentiment as { support: number }).support = 61;
          return { state: working, notes: ["mutated working draft"] };
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(input.economy.sentiment.support).toBe(55);
    expect(result.value.state.economy.sentiment.support).toBe(61);
    expect(result.value.diagnostics.notes).toEqual(["mutated working draft"]);
  });

  it("publishes explicit extension positions for later combos, long-term and reactions", () => {
    expect(TICK_EXTENSION_POINTS).toEqual({
      policyCombos: {
        stage: "activateReservedPolicies",
        position: "after",
      },
      longTermStructure: {
        stage: "updateOutputSupplyIndustries",
        position: "after",
      },
      reactions: {
        stage: "updateHouseholdDistributionSupportPolitics",
        position: "after",
      },
      causalFinalization: {
        stage: "reconcileCausalAndFinalizeSnapshot",
        position: "before-clock-commit",
      },
      reactionSnapshot: {
        stage: "reconcileCausalAndFinalizeSnapshot",
        position: "after-causal-finalization-before-clock-commit",
      },
    });
  });
});
