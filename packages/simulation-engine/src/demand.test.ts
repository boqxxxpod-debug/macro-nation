import { describe, expect, it } from "vitest";
import {
  flowPerMonth,
  indexLevel,
  percentRate,
  scorePoint,
  share01,
  stockLevel,
  type ConfigSnapshot,
  type EconomyState,
  type IndustryId,
  type ScheduledEffect,
} from "@macro-nation/domain";
import {
  XOSHIRO_TICK_RNG_PROVIDER,
  createDemandBatchObservation,
  createRngBundle,
  summarizeDemandBatch,
  updateDemandAndGdp,
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
      marketRate: percentRate(0.03),
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
      policyTrust: scorePoint(50),
      support: scorePoint(55),
      inequality: scorePoint(40),
      speculationPressure: scorePoint(0),
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

function snapshot(
  overrides: Readonly<Record<string, number>> = {},
): ConfigSnapshot {
  return {
    snapshotVersion: "test",
    configHash: "a".repeat(64),
    sourceManifest: [],
    normalizedConfig: {
      parameters: {
        "CORE-GROW-001": 0,
        "CORE-INF-001": 0.02,
        "CORE-U-001": 0.05,
        "CORE-R-001": 0.01,
        "CONS-BASE-001": 0,
        "CONS-Y-001": 0,
        "CONS-R-001": 0,
        "CONS-U-001": 0,
        "CONS-INF-001": 0,
        "CONS-TRUST-001": 0,
        "CONS-ERR-001": 0,
        "INV-BASE-001": 0,
        "INV-GAP-001": 0,
        "INV-PROD-001": 0,
        "INV-R-001": 0,
        "INV-UNC-001": 0,
        "INV-TRUST-001": 0,
        "INV-ERR-001": 0,
        "EXT-GROW-001": 0.025,
        "X-FOREIGN-001": 0,
        "X-FX-001": 0,
        "X-ERR-001": 0,
        "M-DEMAND-001": 0,
        "M-FX-001": 0,
        "M-ERR-001": 0,
        "IS-GAP-PERSIST-001": 0.98,
        "IS-GAP-RATE-001": 0,
        "IS-GAP-FISCAL-001": 0,
        "IS-GAP-FOREIGN-001": 0,
        "IS-GAP-FX-001": 0,
        "IS-GAP-CONFIDENCE-001": 0,
        "IS-GAP-ERR-001": 0,
        "IS-GAP-MIN-001": -0.15,
        "IS-GAP-MAX-001": 0.12,
        "FISC-G-001": 0.8,
        "FISC-G-003": 0.4,
        "FISC-SLACK-THRESHOLD-001": -0.02,
        "FISC-BOOM-THRESHOLD-001": 0.02,
        "PINV-DEMAND-001": 0.004,
        "PINV-SLACK-001": 1.25,
        "PINV-CAP-001": 0.8,
        "PINV-DEBT-001": 0.25,
        "DEBT-RISK-001": 1.2,
        "PINV-DEMAND-HORIZON-001": 12,
        "GDP-SHARE-C-001": 0.6,
        "GDP-SHARE-I-001": 0.18,
        "GDP-SHARE-G-001": 0.2,
        "GDP-SHARE-X-001": 0.25,
        "GDP-SHARE-M-001": 0.23,
        ...overrides,
      },
      nation: {
        initial: { publicInvestment: 4 },
      },
    },
  };
}

function run(
  state: EconomyState,
  config = snapshot(),
  effects: readonly ScheduledEffect[] = [],
  rng = createRngBundle("demand-test"),
  monthIndex = 0,
) {
  return updateDemandAndGdp({
    economy: state,
    effects,
    monthIndex,
    configSnapshot: config,
    rng,
    rngProvider: XOSHIRO_TICK_RNG_PROVIDER,
  });
}

function effect(targetPath: string, baseStrength: number): ScheduledEffect {
  return {
    effectId: "test-effect",
    sourceType: "policy",
    sourceId: "test-policy",
    targetPath,
    operation: "addDelta",
    startMonth: 0,
    endMonth: 0,
    curveId: "flat",
    weights: [1],
    totalWeight: 1,
    baseStrength,
    modifierIds: [],
    uncertainty: { low: 0, high: 0 },
    role: "primary",
    labelKey: "policy.test",
  };
}

const calibrationSnapshot = snapshot({
  "CORE-GROW-001": 0.018,
  "CORE-INF-001": 0.02,
  "CORE-U-001": 0.05,
  "CORE-R-001": 0.01,
  "CONS-BASE-001": 0.015,
  "CONS-Y-001": 0.6,
  "CONS-R-001": 0.45,
  "CONS-U-001": 0.3,
  "CONS-INF-001": 0.2,
  "CONS-TRUST-001": 0.08,
  "CONS-ERR-001": 0.0035,
  "INV-BASE-001": 0.025,
  "INV-GAP-001": 1.2,
  "INV-PROD-001": 0.4,
  "INV-R-001": 1.5,
  "INV-UNC-001": 0.5,
  "INV-TRUST-001": 0.12,
  "INV-ERR-001": 0.0015,
  "EXT-GROW-001": 0.025,
  "X-FOREIGN-001": 0.9,
  "X-FX-001": 0.35,
  "X-ERR-001": 0.005,
  "M-DEMAND-001": 0.9,
  "M-FX-001": -0.25,
  "M-ERR-001": 0.005,
  "IS-GAP-PERSIST-001": 0.98,
  "IS-GAP-RATE-001": 0.48,
  "IS-GAP-FISCAL-001": 0.008,
  "IS-GAP-FOREIGN-001": 0.4,
  "IS-GAP-FX-001": 0.0015,
  "IS-GAP-CONFIDENCE-001": 0.01,
  "IS-GAP-ERR-001": 0.0042,
  "IS-GAP-MIN-001": -0.15,
  "IS-GAP-MAX-001": 0.12,
});

describe("demand and GDP block", () => {
  it("keeps a zero-coefficient baseline stable and preserves the GDP identity", () => {
    const result = run(economy());
    expect(result.economy.indices.realGdp).toBe(100);
    expect(
      result.economy.flows.consumption +
        result.economy.flows.investment +
        result.economy.flows.governmentConsumption +
        result.economy.flows.exports -
        result.economy.flows.imports,
    ).toBeCloseTo(result.economy.indices.realGdp, 12);
  });

  it("reconstructs GDP from potential GDP and a bounded output gap", () => {
    const state = economy();
    const highGap = {
      ...state,
      indices: { ...state.indices, realGdp: indexLevel(200) },
    };
    const result = run(highGap);
    expect(result.diagnostics.outputGapAfter).toBe(0.12);
    expect(result.economy.indices.realGdp).toBeCloseTo(112, 10);
    expect(
      result.economy.flows.consumption +
        result.economy.flows.investment +
        result.economy.flows.governmentConsumption +
        result.economy.flows.exports -
        result.economy.flows.imports,
    ).toBeCloseTo(result.economy.indices.realGdp, 10);
  });

  it("moves GDP in the configured directions for rates, fiscal demand, foreign demand, FX and confidence", () => {
    const state = economy();
    const zeroNoise = snapshot({
      "IS-GAP-RATE-001": 0.48,
      "IS-GAP-FISCAL-001": 0.008,
      "IS-GAP-FOREIGN-001": 0.4,
      "IS-GAP-FX-001": 0.0015,
      "IS-GAP-CONFIDENCE-001": 0.01,
    });
    const base = run(state, zeroNoise).economy.indices.realGdp;
    const rateShock = run(
      {
        ...state,
        rates: { ...state.rates, marketRate: percentRate(0.08) },
      },
      zeroNoise,
    ).economy.indices.realGdp;
    const fiscalShock = run(state, zeroNoise, [
      effect("economy.flows.publicInvestment", 1),
    ]).economy.indices.realGdp;
    const foreignShock = run(
      {
        ...state,
        external: {
          ...state.external,
          foreignGrowthAnnual: percentRate(0.035),
        },
      },
      zeroNoise,
    ).economy.indices.realGdp;
    const fxShock = run(
      {
        ...state,
        indices: { ...state.indices, fx: indexLevel(110) },
      },
      zeroNoise,
    ).economy.indices.realGdp;
    const confidenceShock = run(
      {
        ...state,
        sentiment: {
          ...state.sentiment,
          consumerConfidence: scorePoint(60),
          businessConfidence: scorePoint(60),
        },
      },
      zeroNoise,
    ).economy.indices.realGdp;

    expect(rateShock).toBeLessThan(base);
    expect(fiscalShock).toBeGreaterThan(base);
    expect(foreignShock).toBeGreaterThan(base);
    expect(fxShock).toBeGreaterThan(base);
    expect(confidenceShock).toBeGreaterThan(base);
  });

  it("calibrates a twelve-month 1% GDP public-investment program to the year-one response band", () => {
    const parameters = snapshot({
      "IS-GAP-PERSIST-001": 0.98,
      "IS-GAP-FISCAL-001": 0,
      "PINV-DEMAND-001": 0.004,
    });
    const program: ScheduledEffect = {
      ...effect("economy.flows.publicInvestment", 1),
      endMonth: 11,
      weights: Array(12).fill(1),
      totalWeight: 12,
    };
    const seed = createRngBundle("public-investment-irf");
    let baseline = economy();
    let variant = economy();
    for (let month = 0; month < 12; month += 1) {
      baseline = run(baseline, parameters, [], seed, month).economy;
      variant = run(variant, parameters, [program], seed, month).economy;
    }
    const response = variant.indices.realGdp / baseline.indices.realGdp - 1;
    expect(response).toBeGreaterThanOrEqual(0.002);
    expect(response).toBeLessThanOrEqual(0.008);
    expect(response).toBeCloseTo(0.00256, 4);
    expect(variant.flows.publicInvestment).toBe(5);
  });

  it("reduces public-investment demand response above the configured debt threshold", () => {
    const state = economy();
    const highDebt: EconomyState = {
      ...state,
      ratios: { ...state.ratios, governmentDebtRatio: percentRate(2) },
    };
    const investmentEffect = effect("economy.flows.publicInvestment", 1);
    const normalBase = run(state).economy.indices.realGdp;
    const normalProgram = run(state, snapshot(), [investmentEffect]).economy
      .indices.realGdp;
    const highDebtBase = run(highDebt).economy.indices.realGdp;
    const highDebtProgram = run(highDebt, snapshot(), [investmentEffect])
      .economy.indices.realGdp;

    expect(normalProgram - normalBase).toBeGreaterThan(0);
    expect(highDebtProgram - highDebtBase).toBeLessThan(
      normalProgram - normalBase,
    );
  });

  it("keeps component effects from being counted twice in aggregate GDP", () => {
    const state = economy();
    const baseConfig = snapshot({ "IS-GAP-ERR-001": 0.0042 });
    const componentConfig = snapshot({
      "IS-GAP-ERR-001": 0.0042,
      "CONS-ERR-001": 0.003,
      "INV-ERR-001": 0.0045,
      "X-ERR-001": 0.005,
      "M-ERR-001": 0.005,
    });
    const base = run(state, baseConfig).economy.indices.realGdp;
    const withComponentNoise = run(state, componentConfig).economy.indices
      .realGdp;
    expect(withComponentNoise).toBe(base);
  });

  it("keeps depreciation effects on exports and imports visible", () => {
    const state = economy();
    const result = run(
      {
        ...state,
        indices: {
          ...state.indices,
          fx: indexLevel(120),
          cpi: indexLevel(105),
        },
      },
      snapshot({ "X-FX-001": 0.35, "M-FX-001": -0.25 }),
    );
    expect(result.economy.flows.exports).toBeGreaterThan(25);
    expect(result.economy.flows.imports).toBeLessThan(23);
  });

  it("emits reconciled component, output-gap and GDP causal records", () => {
    const result = run(
      economy(),
      snapshot({ "CONS-BASE-001": 0.012, "IS-GAP-ERR-001": 0.0042 }),
    );
    expect(result.causal.map((item) => item.indicatorId)).toEqual([
      "consumption",
      "investment",
      "governmentConsumption",
      "exports",
      "imports",
      "publicInvestment",
      "outputGap",
      "realGdp",
    ]);
    for (const item of result.causal) {
      expect(
        item.contributions.reduce((sum, term) => sum + term.delta, 0),
      ).toBeCloseTo(item.totalDelta, 10);
    }
  });

  it("passes the 1,000-run, 96-month demand calibration and aggregation gates", () => {
    const runs = Array.from({ length: 1_000 }, (_, seed) => {
      let current = economy();
      let rng = createRngBundle(`demand-calibration-${seed}`);
      const observations = [];
      for (let month = 0; month < 96; month += 1) {
        const output = updateDemandAndGdp({
          economy: current,
          effects: [],
          monthIndex: month,
          configSnapshot: calibrationSnapshot,
          rng,
          rngProvider: XOSHIRO_TICK_RNG_PROVIDER,
        });
        current = output.economy;
        rng = output.rng;
        observations.push(createDemandBatchObservation(output));
      }
      return observations;
    });
    const report = summarizeDemandBatch(runs, 12);
    expect(report.runCount).toBe(1_000);
    expect(report.monthsPerRun).toBe(96);
    expect(report.observationCount).toBe(84_000);
    expect(report.outputGap.standardDeviation * 100).toBeGreaterThanOrEqual(
      1.5,
    );
    expect(report.outputGap.standardDeviation * 100).toBeLessThanOrEqual(2.5);
    expect(
      report.realGdpYearOverYear.standardDeviation * 100,
    ).toBeGreaterThanOrEqual(1.3);
    expect(
      report.realGdpYearOverYear.standardDeviation * 100,
    ).toBeLessThanOrEqual(2.5);
    expect(
      report.realGdpQuarterlyAnnualized.standardDeviation * 100,
    ).toBeGreaterThanOrEqual(1.8);
    expect(
      report.realGdpQuarterlyAnnualized.standardDeviation * 100,
    ).toBeLessThanOrEqual(3.2);

    // Issue calibration bands use three-month growth annualized after warmup.
    for (const component of [
      "consumption",
      "investment",
      "exports",
      "imports",
    ] as const) {
      expect(
        report.correlationQuarterlyAnnualized[component],
      ).toBeGreaterThanOrEqual(
        component === "consumption"
          ? 0.55
          : component === "investment"
            ? 0.65
            : component === "exports"
              ? 0.35
              : 0.5,
      );
      expect(
        report.correlationQuarterlyAnnualized[component],
      ).toBeLessThanOrEqual(0.9);
    }

    expect(report.maxAccountingError).toBeLessThan(1e-9);
    expect(report.maxContributionError).toBeLessThan(1e-9);
    expect(report.maxComponentContributionError).toBeLessThan(1e-10);
    expect(report.maxQuarterlyAggregationError).toBeLessThan(1e-10);

    const meanYearOverYearContribution = Object.values(
      report.componentYearOverYearContribution,
    ).reduce((sum, value) => sum + value.mean, 0);
    expect(meanYearOverYearContribution).toBeCloseTo(
      report.realGdpYearOverYear.mean,
      10,
    );
    const meanQuarterlyContribution = Object.values(
      report.componentQuarterlyAnnualizedContribution,
    ).reduce((sum, value) => sum + value.mean, 0);
    expect(meanQuarterlyContribution).toBeCloseTo(
      report.realGdpQuarterlyAnnualized.mean,
      10,
    );
  });
});
