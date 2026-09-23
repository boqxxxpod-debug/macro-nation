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
import { deriveRiskPremium, updateFiscalIndustries } from "./index";

const INDUSTRY_IDS: readonly IndustryId[] = [
  "agricultureResources",
  "manufacturing",
  "construction",
  "householdServices",
  "financeRealEstate",
  "energyLogistics",
];

const INDUSTRY_SHARES: Readonly<Record<IndustryId, number>> = {
  agricultureResources: 0.08,
  manufacturing: 0.2,
  construction: 0.08,
  householdServices: 0.38,
  financeRealEstate: 0.12,
  energyLogistics: 0.14,
};

const INDUSTRY_LOADINGS = {
  agricultureResources: {
    domesticDemand: 0.4,
    productivity: 0.5,
    foreignDemand: 0.1,
    resourcePrice: 0.25,
    riskPremium: -0.1,
    weather: -0.4,
  },
  manufacturing: {
    domesticDemand: 0.5,
    productivity: 0.8,
    foreignDemand: 0.5,
    resourcePrice: -0.2,
    riskPremium: -0.25,
    weather: -0.05,
  },
  construction: {
    domesticDemand: 0.9,
    productivity: 0.6,
    foreignDemand: 0.05,
    resourcePrice: -0.1,
    riskPremium: -0.5,
    weather: -0.1,
  },
  householdServices: {
    domesticDemand: 0.8,
    productivity: 0.5,
    foreignDemand: 0.05,
    resourcePrice: -0.1,
    riskPremium: -0.2,
    weather: -0.1,
  },
  financeRealEstate: {
    domesticDemand: 0.6,
    productivity: 0.7,
    foreignDemand: 0.15,
    resourcePrice: 0,
    riskPremium: -0.8,
    weather: 0,
  },
  energyLogistics: {
    domesticDemand: 0.45,
    productivity: 0.6,
    foreignDemand: 0.3,
    resourcePrice: 0.2,
    riskPremium: -0.25,
    weather: -0.2,
  },
} satisfies Record<IndustryId, Record<string, number>>;

const PARAMETERS: Readonly<Record<string, number>> = {
  "CORE-GROW-001": 0.018,
  "CORE-INF-001": 0.02,
  "CORE-U-001": 0.05,
  "EXT-GROW-001": 0.025,
  "DEBT-REPRICE-001": 0.015,
  "DEBT-RISK-001": 1.2,
  "DEBT-RISK-002": 0.015,
  "FISC-TAX-ELAS-001": 1,
  "FISC-SLACK-THRESHOLD-001": -0.02,
  "FISC-BOOM-THRESHOLD-001": 0.02,
  "PINV-EFF-001": 0.7,
  "PINV-SUPPLY-001": 0.01,
  "PINV-SUPPLY-LAG-START-001": 12,
  "PINV-SUPPLY-LAG-END-001": 48,
  "PINV-CAP-001": 0.8,
  "PINV-DEBT-001": 0.25,
  "PINV-OVR-001": 1.2,
  "SUP-DEPR-001": 0.001,
  "RISK-DEBT-001": 0.015,
  "TRUST-MR-001": 0.05,
  "TRUST-ANCHOR-001": 60,
  "TRUST-INF-001": 4,
  "TRUST-U-001": 3,
  "TRUST-DEBT-001": 0.5,
  "TRUST-REV-001": -1.5,
  "TRUST-STAB-001": 0.2,
  "TRUST-CRISIS-001": 2,
  "POLCAP-TRUST-001": 0.08,
  "IMPL-REGEN-001": 0.4,
  "IND-GDP-001": 0.8,
  "IND-CAP-001": 0.02,
  "IND-EMP-ADJ-001": 0.1,
  "IND-IMP-ADJ-001": 0.05,
  "IND-IMP-ELAS-001": 0.8,
  "IND-WEATHER-ANCHOR-001": 20,
  "IND-WEATHER-RANGE-001": 80,
  "LT-POP-001": 0.005,
  "LT-INFRA-001": 0.002,
};

function economy(): EconomyState {
  const industries = Object.fromEntries(
    INDUSTRY_IDS.map((id) => [
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

function config(
  overrides: Readonly<Record<string, number>> = {},
): ConfigSnapshot {
  return {
    snapshotVersion: "test",
    configHash: "a".repeat(64),
    sourceManifest: [],
    normalizedConfig: {
      parameters: { ...PARAMETERS, ...overrides },
      nation: {
        initial: { publicInvestment: 4 },
        industryStructure: INDUSTRY_SHARES,
        industryLoadings: INDUSTRY_LOADINGS,
      },
    },
  };
}

function effect(
  targetPath: string,
  baseStrength: number,
  startMonth = 0,
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

function run(
  state: EconomyState,
  monthIndex = 0,
  effects: readonly ScheduledEffect[] = [],
  recentPolicyReversals = 0,
) {
  return updateFiscalIndustries({
    economy: state,
    effects,
    monthIndex,
    configSnapshot: config(),
    recentPolicyReversals,
  });
}

function sumContributions(record: {
  readonly contributions: readonly { readonly delta: number }[];
}): number {
  return record.contributions.reduce((sum, term) => sum + term.delta, 0);
}

describe("fiscal, trust and six-industry model", () => {
  it("reconciles the primary balance, interest, valuation and government debt stocks", () => {
    const initial = economy();
    const result = run(initial, 0, [effect("economy.flows.taxRevenue", 1)]);
    const next = result.economy;

    expect(next.flows.taxRevenue).toBeCloseTo(29, 10);
    expect(next.flows.primaryBalance).toBeCloseTo(-1, 10);
    expect(next.stocks.governmentDebt).toBeCloseTo(
      initial.stocks.governmentDebt -
        next.flows.primaryBalance! +
        next.flows.interestPayment +
        next.flows.debtValuationAdjustment!,
      10,
    );
    expect(
      next.stocks.domesticGovernmentDebt + next.stocks.externalGovernmentDebt,
    ).toBeCloseTo(next.stocks.governmentDebt, 10);
    expect(
      next.stocks.governmentDebt - initial.stocks.governmentDebt,
    ).toBeCloseTo(
      sumContributions(
        result.causal.find((item) => item.indicatorId === "governmentDebt")!,
      ),
      10,
    );
  });

  it("reprices borrowing monthly from the debt and trust risk premium", () => {
    const initial = economy();
    const state: EconomyState = {
      ...initial,
      rates: { ...initial.rates, marketRate: percentRate(0.05) },
      ratios: { ...initial.ratios, governmentDebtRatio: percentRate(1.4) },
      memory: { effectiveDebtRateAnnual: percentRate(0.02) },
      sentiment: { ...initial.sentiment, policyTrust: scorePoint(30) },
    };
    const premium = deriveRiskPremium(state, config());
    const result = run(state);
    const effectiveRate = 0.02 + 0.015 * (0.05 + premium - 0.02);

    expect(premium).toBeCloseTo(0.033, 10);
    expect(result.economy.memory?.effectiveDebtRateAnnual).toBeCloseTo(
      effectiveRate,
      10,
    );
    expect(result.economy.flows.interestPayment).toBeCloseTo(
      (state.stocks.governmentDebt * effectiveRate) / 12,
      10,
    );
  });

  it("keeps a 96-month baseline finite and preserves the debt identity", () => {
    let current = economy();
    for (let month = 0; month < 96; month += 1) {
      const previousDebt = current.stocks.governmentDebt;
      const result = run(current, month);
      current = result.economy;
      expect(Number.isFinite(current.stocks.governmentDebt)).toBe(true);
      expect(current.stocks.governmentDebt).toBeGreaterThanOrEqual(0);
      expect(current.stocks.governmentDebt).toBeCloseTo(
        previousDebt -
          current.flows.primaryBalance! +
          current.flows.interestPayment +
          current.flows.debtValuationAdjustment!,
        8,
      );
      expect(
        current.stocks.domesticGovernmentDebt +
          current.stocks.externalGovernmentDebt,
      ).toBeCloseTo(current.stocks.governmentDebt, 8);
    }
  });

  it("calibrates the 12-month public-investment pulse to the year-four supply band", () => {
    let current = economy();
    let yearOne = 0;
    let yearFour = 0;
    for (let month = 0; month < 48; month += 1) {
      const monthlyInvestment = month < 12 ? 5 : 4;
      const inputState: EconomyState = {
        ...current,
        flows: {
          ...current.flows,
          publicInvestment: flowPerMonth(monthlyInvestment),
        },
      };
      const result = run(inputState, month);
      current = result.economy;
      if (month === 11) yearOne = current.indices.potentialGdp / 100 - 1;
      if (month === 47) yearFour = current.indices.potentialGdp / 100 - 1;
    }

    expect(yearOne).toBeCloseTo(0, 10);
    expect(yearFour).toBeGreaterThanOrEqual(0.007);
    expect(yearFour).toBeLessThanOrEqual(0.016);
    expect(current.stocks.publicCapital).toBeGreaterThan(0);
  });

  it("applies the debt constraint to incremental public-capital formation", () => {
    const initial = economy();
    const investment: EconomyState = {
      ...initial,
      flows: { ...initial.flows, publicInvestment: flowPerMonth(5) },
    };
    const highDebt: EconomyState = {
      ...investment,
      ratios: { ...investment.ratios, governmentDebtRatio: percentRate(2) },
    };

    expect(run(investment).economy.stocks.publicCapital).toBeGreaterThan(
      run(highDebt).economy.stocks.publicCapital,
    );
  });

  it("models crisis and policy reversals while clamping trust to its bounds", () => {
    const initial = economy();
    const steady = run(initial).economy.sentiment.policyTrust;
    const crisisInput: EconomyState = {
      ...initial,
      external: { ...initial.external, disasterAlert: scorePoint(100) },
    };
    const crisisTrust = run(crisisInput, 0, [], 1).economy.sentiment
      .policyTrust;
    const clamped = run(
      {
        ...initial,
        sentiment: { ...initial.sentiment, policyTrust: scorePoint(5) },
      },
      0,
      [effect("economy.sentiment.policyTrust", -20)],
    ).economy.sentiment.policyTrust;

    expect(crisisTrust).toBeLessThan(steady);
    expect(clamped).toBe(0);
  });

  it("updates employment, import dependence, capacity and production by industry", () => {
    const initial = economy();
    const state: EconomyState = {
      ...initial,
      indices: { ...initial.indices, importPrice: indexLevel(120) },
      memory: { previousResourcePriceIndex: indexLevel(100) },
      external: {
        ...initial.external,
        resourcePriceIndex: indexLevel(120),
      },
    };
    const result = run(state, 0, [
      effect("economy.industries.manufacturing.productionIndex", 8),
    ]);
    const next = result.economy;
    const manufacturing = next.industries.manufacturing;
    const employmentTotal = Object.values(next.industries).reduce(
      (sum, industry) => sum + industry.employmentShare,
      0,
    );
    const productionTotal = INDUSTRY_IDS.reduce(
      (sum, id) =>
        sum + next.industries[id].productionIndex * INDUSTRY_SHARES[id],
      0,
    );

    expect(manufacturing.employmentShare).toBeGreaterThan(1 / 6);
    expect(manufacturing.importDependency).toBeLessThan(0.2);
    expect(employmentTotal).toBeCloseTo(1, 10);
    expect(productionTotal).toBeCloseTo(next.indices.realGdp, 10);
    expect(result.causal.map((item) => item.indicatorId)).toContain(
      "industry.manufacturing.capacity",
    );
    expect(result.industryAggregateResidual).not.toBe(0);
    expect(result.causal.map((item) => item.indicatorId)).toContain(
      "industryAggregateResidual",
    );
    for (const id of INDUSTRY_IDS) {
      const beforeCapacity = initial.industries[id].capacityIndex;
      const afterCapacity = next.industries[id].capacityIndex;
      const capacityRecord = result.causal.find(
        (item) => item.indicatorId === `industry.${id}.capacity`,
      );
      expect(capacityRecord).toBeDefined();
      expect(afterCapacity - beforeCapacity).toBeCloseTo(
        sumContributions(capacityRecord!),
        10,
      );
    }
  });

  it("records each configured external and risk loading in industry production contributions", () => {
    const initial = economy();
    const state: EconomyState = {
      ...initial,
      ratios: { ...initial.ratios, governmentDebtRatio: percentRate(1.8) },
      sentiment: { ...initial.sentiment, policyTrust: scorePoint(40) },
      memory: { previousResourcePriceIndex: indexLevel(100) },
      external: {
        ...initial.external,
        foreignGrowthAnnual: percentRate(0.045),
        resourcePriceIndex: indexLevel(120),
        disasterAlert: scorePoint(100),
      },
    };
    const result = run(state);
    const record = (id: IndustryId) =>
      result.causal.find(
        (item) => item.indicatorId === `industry.${id}.production`,
      )!;
    const delta = (id: IndustryId, sourceId: string) =>
      record(id).contributions.find((term) => term.sourceId === sourceId)!
        .delta;

    expect(delta("manufacturing", "industry-world-demand")).toBeGreaterThan(
      delta("agricultureResources", "industry-world-demand"),
    );
    expect(
      delta("agricultureResources", "industry-resource-price"),
    ).toBeGreaterThan(delta("manufacturing", "industry-resource-price"));
    expect(delta("financeRealEstate", "industry-risk-premium")).toBeLessThan(
      delta("manufacturing", "industry-risk-premium"),
    );
    expect(delta("agricultureResources", "industry-weather")).toBeLessThan(
      delta("householdServices", "industry-weather"),
    );
    expect(result.industryAggregateResidual).not.toBe(0);
  });
});
