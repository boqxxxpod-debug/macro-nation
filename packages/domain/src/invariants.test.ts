import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLOCK_CONFIG,
  assertReproducibleConfig,
  canTransitionRunState,
  flowPerMonth,
  indexLevel,
  percentRate,
  scorePoint,
  share01,
  stockLevel,
  validateState,
  type EconomyState,
  type GameState,
  type IndustryId,
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
      publicCapital: stockLevel(0),
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

function state(): GameState {
  return {
    gameId: "g1",
    slotId: 1,
    nationId: "standard-nation-v1",
    scenarioId: "SCN-01",
    difficulty: "standard",
    monthIndex: 0,
    tickSequence: 0,
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
    rng: { rootSeed: "seed", rngVersion: "xoshiro128ss-v1", streams: {} },
    crisisCounters: {},
    history: { snapshotMonths: [] },
    clock: { stepIndex: 0, year: 2026, month: 1, config: DEFAULT_CLOCK_CONFIG },
    versions: {
      saveSchemaVersion: "1",
      engineVersion: "0.1.0",
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

describe("domain invariants", () => {
  it("accepts valid state and hard-clamp boundary values", () => {
    const valid = state();
    const boundary: GameState = {
      ...valid,
      economy: {
        ...valid.economy,
        rates: { ...valid.economy.rates, policyRate: percentRate(-0.02) },
      },
    };
    expect(validateState(boundary)).toEqual([]);
  });

  it("rejects NaN, out-of-range state and debt mismatch", () => {
    const valid = state();
    const invalid: GameState = {
      ...valid,
      economy: {
        ...valid.economy,
        indices: {
          ...valid.economy.indices,
          realGdp: Number.NaN as EconomyState["indices"]["realGdp"],
        },
        rates: {
          ...valid.economy.rates,
          unemployment: percentRate(0.31),
        },
        stocks: {
          ...valid.economy.stocks,
          governmentDebt: stockLevel(999),
        },
      },
    };
    expect(validateState(invalid).map((item) => item.code)).toEqual(
      expect.arrayContaining(["NON_FINITE", "OUT_OF_RANGE", "DEBT_MISMATCH"]),
    );
  });

  it("validates the market rate and persisted macro history", () => {
    const valid = state();
    const invalid: GameState = {
      ...valid,
      economy: {
        ...valid.economy,
        rates: { ...valid.economy.rates, marketRate: percentRate(0.31) },
        memory: {
          previousRealGdp: indexLevel(0),
          outputGrowthGapHistory: [
            Number.NaN as EconomyState["rates"]["unemployment"],
          ],
        },
      },
    };
    const paths = validateState(invalid).map((item) => item.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "economy.rates.marketRate",
        "economy.memory.previousRealGdp",
        "economy.memory.outputGrowthGapHistory[0]",
      ]),
    );
  });

  it("rejects duplicate lifecycle IDs and reversed effect months", () => {
    const valid = state();
    const policy = {
      policyId: "p1",
      type: "interestRate" as const,
      decidedMonth: 0,
      activationMonth: 0,
      status: "active" as const,
      slotQuarter: 0,
      costs: {
        politicalCapital: 0,
        implementationCapacity: 0,
        foreignReserves: 0,
        immediateBudget: 0,
      },
      sourceCommandId: "c1",
    };
    const invalid: GameState = {
      ...valid,
      policies: {
        active: [policy],
        reserved: [policy],
        completed: [],
        cancelled: [],
      },
      effects: [
        {
          effectId: "e1",
          sourceType: "policy",
          sourceId: "p1",
          targetPath: "economy.indices.realGdp",
          operation: "addDelta",
          startMonth: 3,
          endMonth: 2,
          curveId: "hump",
          weights: [0.5, 0.5],
          totalWeight: 1,
          baseStrength: 1,
          modifierIds: [],
          uncertainty: { low: 0, high: 0 },
          role: "primary",
          labelKey: "effect.p1",
        },
      ],
    };
    expect(validateState(invalid).map((item) => item.code)).toEqual(
      expect.arrayContaining(["DUPLICATE_POLICY_ID", "INVALID_EFFECT"]),
    );
  });

  it("makes completed and failed terminal", () => {
    expect(canTransitionRunState("completed", "running")).toBe(false);
    expect(canTransitionRunState("failed", "paused")).toBe(false);
    expect(canTransitionRunState("awaitingEvent", "running")).toBe(true);
  });

  it("rejects a saved policy containing a non-finite new input", () => {
    const valid = state();
    const invalid: GameState = {
      ...valid,
      policies: {
        ...valid.policies,
        active: [
          {
            policyId: "p2",
            type: "housingTax",
            decidedMonth: 0,
            activationMonth: 0,
            status: "active",
            slotQuarter: 0,
            sourceCommandId: "c2",
            costs: {
              politicalCapital: 0,
              implementationCapacity: 0,
              foreignReserves: 0,
              immediateBudget: 0,
            },
            inputs: { rate: Number.NaN },
          },
        ],
      },
    };
    expect(validateState(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_POLICY_INPUT",
          path: "policies.p2.inputs.rate",
        }),
      ]),
    );
  });

  it("treats replay config identity mismatch as a hard error", () => {
    expect(() =>
      assertReproducibleConfig(
        { configHash: "a".repeat(64), sourceManifest: [] },
        { configHash: "b".repeat(64), sourceManifest: [] },
      ),
    ).toThrow(/Config hash mismatch/);
  });
});
