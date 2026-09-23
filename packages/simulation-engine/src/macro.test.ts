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
  createRngBundle,
  updateDemandAndGdp,
  updateFx,
  updatePricesLabor,
} from "./index";

const PARAMETERS: Readonly<Record<string, number>> = {
  "CORE-GROW-001": 0.018,
  "CORE-INF-001": 0.02,
  "CORE-U-001": 0.05,
  "CORE-R-001": 0.01,
  "LAB-OKUN-001": 0.47,
  "LAB-MR-MONTHLY-001": 0.04,
  "CONF-ANCHOR-001": 50,
  "CONF-C-GAP-001": 0.22,
  "CONF-B-GAP-001": 0.27,
  "CONF-MR-MONTHLY-001": 0.25,
  "CONF-ERR-001": 0.5,
  "INF-PERS-001": 0.9,
  "INF-GAP-001": 0.08,
  "INF-ERR-001": 0.0018,
  "INF-IMPORT-001": 0.05,
  "INF-WAGE-001": 0.08,
  "INF-SUPPLY-001": 0.12,
  "IMP-FX-001": 0.65,
  "IMP-RESOURCE-001": 0.3,
  "IMP-STATE-001": 0.25,
  "EXP-PERS-001": 0.9,
  "EXP-ANCHOR-001": 0.35,
  "WAGE-INF-001": 0.4,
  "WAGE-LABOR-001": 0.2,
  "MON-PASS-001": 0.8,
  "FX-RATE-DIFF-001": 0.8,
  "FX-CA-001": -0.25,
  "FX-TRUST-RISK-001": 0.2,
  "FX-EXPECT-001": 0.25,
  "FX-SPEC-001": 0.15,
  "FX-ERR-001": 0,
  "RISK-DEBT-001": 0.015,
  "DEBT-RISK-001": 1.2,
  "DEBT-RISK-002": 0.015,
  "FISC-G-001": 0.8,
  "FISC-G-003": 0.4,
  "FISC-SLACK-THRESHOLD-001": -0.02,
  "FISC-BOOM-THRESHOLD-001": 0.02,
  "PINV-DEMAND-001": 0.004,
  "PINV-SLACK-001": 1.25,
  "PINV-CAP-001": 0.8,
  "PINV-DEBT-001": 0.25,
  "PINV-DEMAND-HORIZON-001": 12,
  "CONS-BASE-001": 0.015,
  "CONS-Y-001": 0.6,
  "CONS-R-001": 0.45,
  "CONS-U-001": 0.3,
  "CONS-INF-001": 0.2,
  "CONS-TRUST-001": 0.08,
  "CONS-ERR-001": 0,
  "INV-BASE-001": 0.025,
  "INV-GAP-001": 1.2,
  "INV-PROD-001": 0.4,
  "INV-R-001": 1.5,
  "INV-UNC-001": 0.5,
  "INV-TRUST-001": 0.12,
  "INV-ERR-001": 0,
  "EXT-GROW-001": 0.025,
  "X-FOREIGN-001": 0.9,
  "X-FX-001": 0.35,
  "X-ERR-001": 0,
  "M-DEMAND-001": 0.9,
  "M-FX-001": -0.25,
  "M-ERR-001": 0,
  "IS-GAP-PERSIST-001": 0.98,
  "IS-GAP-RATE-001": 0.48,
  "IS-GAP-FISCAL-001": 0.008,
  "IS-GAP-FOREIGN-001": 0.4,
  "IS-GAP-FX-001": 0.0015,
  "IS-GAP-CONFIDENCE-001": 0.01,
  "IS-GAP-ERR-001": 0,
  "IS-GAP-MIN-001": -0.15,
  "IS-GAP-MAX-001": 0.12,
  "GDP-SHARE-C-001": 0.6,
  "GDP-SHARE-I-001": 0.18,
  "GDP-SHARE-G-001": 0.2,
  "GDP-SHARE-X-001": 0.25,
  "GDP-SHARE-M-001": 0.23,
};

const OKUN_KERNEL = {
  kernelId: "okun-hump-3-9",
  start: 3,
  peak: 6,
  end: 9,
  shape: "hump",
  weights: [0.08, 0.14, 0.19, 0.22, 0.17, 0.12, 0.08],
};

function config(
  overrides: Readonly<Record<string, number>> = {},
): ConfigSnapshot {
  return {
    snapshotVersion: "test",
    configHash: "a".repeat(64),
    sourceManifest: [],
    normalizedConfig: {
      parameters: { ...PARAMETERS, ...overrides },
      lagKernels: [OKUN_KERNEL],
    },
  };
}

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

function input(
  state: EconomyState,
  monthIndex = 0,
  effects: readonly ScheduledEffect[] = [],
  rng = createRngBundle("macro-test"),
  configSnapshot = config(),
) {
  return {
    economy: state,
    effects,
    monthIndex,
    configSnapshot,
    rng,
    rngProvider: XOSHIRO_TICK_RNG_PROVIDER,
  };
}

function effect(
  targetPath: string,
  startMonth: number,
  baseStrength: number,
): ScheduledEffect {
  return {
    effectId: `test-${targetPath}`,
    sourceType: "policy",
    sourceId: "test-policy",
    targetPath,
    operation: "addDelta",
    startMonth,
    endMonth: startMonth,
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

type Observation = {
  readonly realGdp: number;
  readonly cpi: number;
  readonly unemployment: number;
  readonly fx: number;
  readonly marketRate: number;
};

function simulateRatePath(withShock: boolean): Observation[] {
  let current = {
    ...economy(),
    rates: {
      ...economy().rates,
      policyRate: percentRate(0.02),
      marketRate: percentRate(0.02),
    },
  };
  let rng = createRngBundle("monetary-golden-response");
  const observations: Observation[] = [];
  for (let month = 0; month < 36; month += 1) {
    current = {
      ...current,
      rates: {
        ...current.rates,
        policyRate: percentRate(withShock && month < 12 ? 0.03 : 0.02),
      },
    };
    const demand = updateDemandAndGdp({
      economy: current,
      effects: [],
      monthIndex: month,
      configSnapshot: config(),
      rng,
      rngProvider: XOSHIRO_TICK_RNG_PROVIDER,
    });
    current = demand.economy;
    rng = demand.rng;
    const prices = updatePricesLabor(input(current, month, [], rng));
    current = prices.economy;
    rng = prices.rng;
    const exchange = updateFx(input(current, month, [], rng));
    current = exchange.economy;
    rng = exchange.rng;
    observations.push({
      realGdp: current.indices.realGdp,
      cpi: current.indices.cpi,
      unemployment: current.rates.unemployment,
      fx: current.indices.fx,
      marketRate: current.rates.marketRate,
    });
  }
  return observations;
}

function correlation(
  left: readonly number[],
  right: readonly number[],
): number {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index]! - leftMean;
    const rightDelta = right[index]! - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  return covariance / Math.sqrt(leftVariance * rightVariance);
}

function simulateNormalPeriod(seed: number): {
  gaps: number[];
  unemployment: number[];
  inflation: number[];
  confidence: number[];
} {
  let current = economy();
  let rng = createRngBundle(`normal-period-${seed}`);
  const gaps: number[] = [];
  const unemployment: number[] = [];
  const inflation: number[] = [];
  const confidence: number[] = [];
  const snapshot = config();
  let outputGap = 0;
  const potentialGrowthMonthly = Math.pow(
    1 + PARAMETERS["CORE-GROW-001"]!,
    1 / 12,
  );
  for (let month = 0; month < 168; month += 1) {
    const gapDraw = XOSHIRO_TICK_RNG_PROVIDER.drawFloat01(
      rng,
      "calibration.outputGap",
    );
    rng = gapDraw.bundle;
    outputGap =
      0.98 * outputGap + Math.sqrt(3) * 0.0042 * (2 * gapDraw.value - 1);
    const potentialGdp = current.indices.potentialGdp * potentialGrowthMonthly;
    current = {
      ...current,
      indices: {
        ...current.indices,
        potentialGdp: indexLevel(potentialGdp),
        realGdp: indexLevel(potentialGdp * (1 + outputGap)),
      },
    };
    const prices = updatePricesLabor(input(current, month, [], rng, snapshot));
    current = prices.economy;
    rng = prices.rng;
    if (month >= 24) {
      gaps.push(outputGap);
      unemployment.push(current.rates.unemployment);
      inflation.push(current.rates.inflationAnnual);
      confidence.push(
        (current.sentiment.consumerConfidence +
          current.sentiment.businessConfidence) /
          2,
      );
    }
  }
  return { gaps, unemployment, inflation, confidence };
}

describe("prices, employment, expectations and FX", () => {
  it("passes the policy rate to market rates quickly and records the cause", () => {
    const state = economy();
    const restrictive = {
      ...state,
      rates: {
        ...state.rates,
        policyRate: percentRate(0.03),
        marketRate: percentRate(0.02),
      },
    };
    const result = updatePricesLabor(input(restrictive));
    expect(result.economy.rates.marketRate).toBeCloseTo(0.028, 12);
    const contribution = result.causal.find(
      (item) => item.indicatorId === "marketRate",
    );
    expect(contribution?.beforeValue).toBeCloseTo(0.02, 12);
    expect(contribution?.afterValue).toBeCloseTo(0.028, 12);
  });

  it("updates confidence toward an output-gap target with separate causal streams", () => {
    const initial = economy();
    const result = updatePricesLabor(
      input(
        {
          ...initial,
          indices: { ...initial.indices, realGdp: indexLevel(102) },
        },
        0,
        [],
        createRngBundle("confidence-test"),
        config({ "CONF-ERR-001": 0 }),
      ),
    );
    expect(result.economy.sentiment.consumerConfidence).toBeGreaterThan(50);
    expect(result.economy.sentiment.businessConfidence).toBeGreaterThan(50);
    expect(result.causal.map((item) => item.indicatorId)).toContain(
      "consumerConfidence",
    );
    expect(result.causal.map((item) => item.indicatorId)).toContain(
      "businessConfidence",
    );
    expect(result.rng.streams["error.consumerConfidence"]?.drawCount).toBe(1);
    expect(result.rng.streams["error.businessConfidence"]?.drawCount).toBe(1);
  });

  it("keeps normal-period macro correlations inside the calibrated bands", () => {
    const runs = Array.from({ length: 16 }, (_, seed) =>
      simulateNormalPeriod(seed),
    );
    const gaps = runs.flatMap((run) => run.gaps);
    const unemployment = runs.flatMap((run) => run.unemployment);
    const inflation = runs.flatMap((run) => run.inflation);
    const confidence = runs.flatMap((run) => run.confidence);
    const gapUnemployment = correlation(gaps, unemployment);
    const gapInflation = correlation(gaps, inflation);
    const gapConfidence = correlation(gaps, confidence);
    expect(gapUnemployment).toBeGreaterThanOrEqual(-0.9);
    expect(gapUnemployment).toBeLessThanOrEqual(-0.6);
    expect(gapInflation).toBeGreaterThanOrEqual(0.15);
    expect(gapInflation).toBeLessThanOrEqual(0.55);
    expect(gapConfidence).toBeGreaterThanOrEqual(0.5);
    expect(gapConfidence).toBeLessThanOrEqual(0.85);
  });

  it("passes a 10% depreciation quickly to import prices and gradually to CPI", () => {
    const initial = economy();
    const runPrices = (fx: number): EconomyState => {
      let state = {
        ...initial,
        indices: { ...initial.indices, fx: indexLevel(fx) },
      };
      let rng = createRngBundle("pass-through");
      for (let month = 0; month < 12; month += 1) {
        const result = updatePricesLabor(input(state, month, [], rng));
        state = result.economy;
        rng = result.rng;
      }
      return state;
    };
    const firstMonth = updatePricesLabor(
      input({
        ...initial,
        indices: { ...initial.indices, fx: indexLevel(110) },
      }),
    );
    const baseline = runPrices(100);
    const depreciated = runPrices(110);
    const cumulativeCpi = depreciated.indices.cpi / baseline.indices.cpi - 1;
    expect(firstMonth.economy.indices.importPrice).toBeCloseTo(106.5, 8);
    expect(cumulativeCpi).toBeGreaterThanOrEqual(0.002);
    expect(cumulativeCpi).toBeLessThanOrEqual(0.015);
  });

  it("raises inflation under demand pressure and binding industry capacity", () => {
    const initial = economy();
    const hotDemand = {
      ...initial,
      indices: { ...initial.indices, realGdp: indexLevel(104) },
    };
    const constrained = {
      ...initial,
      industries: {
        ...initial.industries,
        manufacturing: {
          ...initial.industries.manufacturing,
          productionIndex: indexLevel(120),
        },
      },
    };
    const base = updatePricesLabor(input(initial));
    const demand = updatePricesLabor(input(hotDemand));
    const supply = updatePricesLabor(input(constrained));
    expect(demand.economy.rates.inflationAnnual).toBeGreaterThan(
      base.economy.rates.inflationAnnual,
    );
    expect(supply.economy.rates.inflationAnnual).toBeGreaterThan(
      base.economy.rates.inflationAnnual,
    );
    expect(
      supply.causal
        .find((item) => item.indicatorId === "inflation")
        ?.contributions.some(
          (term) => term.sourceId === "inflation-supply-capacity",
        ),
    ).toBe(true);
  });

  it("spreads the Okun response across the configured 3-9 month kernel", () => {
    let state: EconomyState = {
      ...economy(),
      memory: {
        previousRealGdp: indexLevel(100),
        outputGrowthGapHistory: [],
      },
    };
    const growthShock = Math.pow(1.038, 1 / 12);
    state = {
      ...state,
      indices: { ...state.indices, realGdp: indexLevel(100 * growthShock) },
    };
    let rng = createRngBundle("okun-lag");
    const rates: number[] = [];
    for (let month = 0; month <= 3; month += 1) {
      if (month > 0) {
        state = {
          ...state,
          indices: {
            ...state.indices,
            realGdp: indexLevel(
              (state.memory?.previousRealGdp ?? state.indices.realGdp) *
                Math.pow(1.018, 1 / 12),
            ),
          },
        };
      }
      const result = updatePricesLabor(input(state, month, [], rng));
      state = result.economy;
      rng = result.rng;
      rates.push(state.rates.unemployment);
    }
    expect(rates.slice(0, 3).every((rate) => rate === 0.05)).toBe(true);
    expect(rates[3]!).toBeLessThan(0.05);
  });

  it("applies phased policy effects only in their scheduled month", () => {
    const initial = economy();
    const jobEffect = effect("economy.rates.unemployment", 3, 0.001);
    const before = updatePricesLabor(input(initial, 2, [jobEffect]));
    const active = updatePricesLabor(input(initial, 3, [jobEffect]));
    expect(before.economy.rates.unemployment).toBeCloseTo(
      active.economy.rates.unemployment - 0.001,
      10,
    );
    expect(
      active.causal
        .find((item) => item.indicatorId === "unemployment")
        ?.contributions.some((term) => term.sourceId === "test-policy"),
    ).toBe(true);

    const fxEffect = effect("economy.indices.fx", 3, 1);
    const fxBefore = updateFx(input(initial, 2, [fxEffect]));
    const fxActive = updateFx(input(initial, 3, [fxEffect]));
    expect(fxActive.economy.indices.fx).toBeCloseTo(
      fxBefore.economy.indices.fx + 1,
      10,
    );
  });

  it("depreciates the currency after a confidence collapse, higher risk premium, or higher inflation expectations", () => {
    const initial = economy();
    const fx = (state: EconomyState) =>
      updateFx(input(state)).economy.indices.fx;
    expect(
      fx({
        ...initial,
        sentiment: { ...initial.sentiment, policyTrust: scorePoint(10) },
      }),
    ).toBeGreaterThan(fx(initial));
    expect(
      fx({
        ...initial,
        ratios: { ...initial.ratios, governmentDebtRatio: percentRate(1.8) },
      }),
    ).toBeGreaterThan(fx(initial));
    expect(
      fx({
        ...initial,
        rates: { ...initial.rates, expectedInflation: percentRate(0.05) },
      }),
    ).toBeGreaterThan(fx(initial));
  });

  it("keeps extreme price and FX shocks finite and bounded", () => {
    const initial = economy();
    const extreme: EconomyState = {
      ...initial,
      indices: {
        ...initial.indices,
        realGdp: indexLevel(112),
        fx: indexLevel(500),
      },
      external: { ...initial.external, resourcePriceIndex: indexLevel(1000) },
      sentiment: {
        ...initial.sentiment,
        policyTrust: scorePoint(0),
        speculationPressure: scorePoint(100),
      },
      industries: {
        ...initial.industries,
        manufacturing: {
          ...initial.industries.manufacturing,
          productionIndex: indexLevel(500),
        },
      },
    };
    const prices = updatePricesLabor(input(extreme));
    const exchange = updateFx(input(prices.economy, 0, [], prices.rng));
    expect(prices.economy.rates.inflationAnnual).toBeLessThanOrEqual(0.5);
    expect(prices.economy.rates.unemployment).toBeGreaterThanOrEqual(0.02);
    expect(prices.economy.rates.unemployment).toBeLessThanOrEqual(0.3);
    expect(prices.economy.rates.marketRate).toBeGreaterThanOrEqual(-0.02);
    expect(prices.economy.rates.marketRate).toBeLessThanOrEqual(0.3);
    expect(exchange.economy.indices.fx).toBeGreaterThanOrEqual(20);
    expect(exchange.economy.indices.fx).toBeLessThanOrEqual(500);
    expect(Object.values(prices.economy.indices).every(Number.isFinite)).toBe(
      true,
    );
  });

  it("produces a deterministic paired response to a 12-month 100bp policy-rate increase", () => {
    const baseline = simulateRatePath(false);
    const variant = simulateRatePath(true);
    expect(simulateRatePath(true)).toEqual(variant);

    const fxDifferences = variant.map(
      (item, index) => item.fx / baseline[index]!.fx - 1,
    );
    const gdpDifferences = variant.map(
      (item, index) => item.realGdp / baseline[index]!.realGdp - 1,
    );
    const cpiDifferences = variant.map(
      (item, index) => item.cpi / baseline[index]!.cpi - 1,
    );
    const unemploymentDifferences = variant.map(
      (item, index) => item.unemployment - baseline[index]!.unemployment,
    );
    const fxWindow = Math.min(...fxDifferences.slice(0, 6));
    const gdpTrough = Math.min(...gdpDifferences.slice(11, 24));
    const unemploymentPeak = Math.max(...unemploymentDifferences.slice(14, 24));
    const cpiTrough = Math.min(...cpiDifferences.slice(17, 36));

    expect(fxDifferences.slice(0, 3).some((difference) => difference < 0)).toBe(
      true,
    );
    expect(fxWindow).toBeGreaterThanOrEqual(-0.015);
    expect(fxWindow).toBeLessThanOrEqual(-0.003);
    expect(gdpTrough).toBeGreaterThanOrEqual(-0.01);
    expect(gdpTrough).toBeLessThanOrEqual(-0.003);
    expect(unemploymentPeak).toBeGreaterThanOrEqual(0.0015);
    expect(unemploymentPeak).toBeLessThanOrEqual(0.005);
    expect(cpiTrough).toBeGreaterThanOrEqual(-0.01);
    expect(cpiTrough).toBeLessThanOrEqual(-0.002);
  });

  it("keeps paired shocks on the same deterministic random path", () => {
    const first = updateFx(
      input(economy(), 0, [], createRngBundle("same-seed")),
    );
    const second = updateFx(
      input(economy(), 0, [], createRngBundle("same-seed")),
    );
    expect(second).toEqual(first);
    expect(first.rng.streams["error.fx"]?.drawCount).toBe(1);
  });

  it("reconciles foreign reserves to the current-account and capital-flow balance", () => {
    const initial = economy();
    const result = updateFx(input(initial));
    const reserveDelta =
      result.economy.stocks.foreignReserves - initial.stocks.foreignReserves;

    expect(result.economy.flows.foreignReserveChange).toBeCloseTo(
      reserveDelta,
      10,
    );
    expect(reserveDelta).toBeCloseTo(
      initial.flows.currentAccount + result.economy.flows.capitalFlow,
      10,
    );
    expect(
      result.causal.find((item) => item.indicatorId === "foreignReserves")
        ?.totalDelta,
    ).toBeCloseTo(reserveDelta, 10);
  });
});
