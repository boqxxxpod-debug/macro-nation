import {
  INDUSTRY_IDS,
  flowPerMonth,
  indexLevel,
  percentRate,
  scorePoint,
  share01,
  stockLevel,
  type CausalContribution,
  type CausalMetricId,
  type CausalRef,
  type ConfigSnapshot,
  type EconomyState,
  type GameState,
  type IndustryId,
  type IndustryState,
  type ScheduledEffect,
} from "@macro-nation/domain";
import { createContributionBuilder } from "./causal";
import type { TickStageHandler } from "./tick";

type FiscalParameterId =
  | "CORE-GROW-001"
  | "CORE-INF-001"
  | "CORE-U-001"
  | "DEBT-REPRICE-001"
  | "DEBT-RISK-001"
  | "DEBT-RISK-002"
  | "EXT-GROW-001"
  | "FISC-TAX-ELAS-001"
  | "FISC-SLACK-THRESHOLD-001"
  | "FISC-BOOM-THRESHOLD-001"
  | "PINV-EFF-001"
  | "PINV-SUPPLY-001"
  | "PINV-SUPPLY-LAG-START-001"
  | "PINV-SUPPLY-LAG-END-001"
  | "PINV-CAP-001"
  | "PINV-DEBT-001"
  | "PINV-OVR-001"
  | "SUP-DEPR-001"
  | "RISK-DEBT-001"
  | "TRUST-MR-001"
  | "TRUST-ANCHOR-001"
  | "TRUST-INF-001"
  | "TRUST-U-001"
  | "TRUST-DEBT-001"
  | "TRUST-REV-001"
  | "TRUST-STAB-001"
  | "TRUST-CRISIS-001"
  | "POLCAP-TRUST-001"
  | "IMPL-REGEN-001"
  | "IND-GDP-001"
  | "IND-CAP-001"
  | "IND-EMP-ADJ-001"
  | "IND-IMP-ADJ-001"
  | "IND-IMP-ELAS-001"
  | "IND-WEATHER-ANCHOR-001"
  | "IND-WEATHER-RANGE-001"
  | "LT-POP-001"
  | "LT-INFRA-001";

interface Term {
  readonly source: CausalRef;
  readonly delta: number;
}

export interface FiscalIndustryInput {
  readonly economy: EconomyState;
  readonly effects: readonly ScheduledEffect[];
  readonly monthIndex: number;
  readonly configSnapshot: ConfigSnapshot;
  readonly recentPolicyReversals?: number;
}

export interface LongTermHooks {
  readonly populationGrowthAnnual: number;
  readonly productivityGrowthAnnual: number;
  readonly infrastructureContributionAnnual: number;
  readonly publicInvestmentPotentialEffect: number;
}

export interface FiscalIndustryOutput {
  readonly economy: EconomyState;
  readonly causal: readonly CausalContribution[];
  readonly longTermHooks: LongTermHooks;
  readonly industryAggregateResidual: number;
}

interface IndustryLoading {
  readonly domesticDemand: number;
  readonly productivity: number;
  readonly foreignDemand: number;
  readonly resourcePrice: number;
  readonly riskPremium: number;
  readonly weather: number;
}

interface NationIndustryModel {
  readonly shares: Readonly<Record<IndustryId, number>>;
  readonly loadings: Readonly<Record<IndustryId, IndustryLoading>>;
}

function parameters(
  snapshot: ConfigSnapshot,
): Readonly<Record<string, number>> {
  const value = snapshot.normalizedConfig.parameters;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ConfigSnapshot.normalizedConfig.parameters is required");
  }
  return value as Readonly<Record<string, number>>;
}

function parameter(
  values: Readonly<Record<string, number>>,
  id: FiscalParameterId,
): number {
  const value = values[id];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing or invalid fiscal parameter ${id}`);
  }
  return value;
}

function nationIndustryModel(snapshot: ConfigSnapshot): NationIndustryModel {
  const nation = snapshot.normalizedConfig.nation;
  if (!nation || typeof nation !== "object" || Array.isArray(nation)) {
    throw new Error("ConfigSnapshot.normalizedConfig.nation is required");
  }
  const record = nation as Record<string, unknown>;
  const rawShares = record.industryStructure;
  const rawLoadings = record.industryLoadings;
  if (
    !rawShares ||
    typeof rawShares !== "object" ||
    Array.isArray(rawShares) ||
    !rawLoadings ||
    typeof rawLoadings !== "object" ||
    Array.isArray(rawLoadings)
  ) {
    throw new Error("Nation industry shares and loadings are required");
  }
  const shares = {} as Record<IndustryId, number>;
  const loadings = {} as Record<IndustryId, IndustryLoading>;
  for (const id of INDUSTRY_IDS) {
    const share = (rawShares as Record<string, unknown>)[id];
    const loading = (rawLoadings as Record<string, unknown>)[id];
    if (typeof share !== "number" || !Number.isFinite(share) || share < 0) {
      throw new Error(`Invalid Nation industry share ${id}`);
    }
    if (!loading || typeof loading !== "object" || Array.isArray(loading)) {
      throw new Error(`Missing Nation industry loading ${id}`);
    }
    const values = loading as Record<string, unknown>;
    const fields = [
      "domesticDemand",
      "productivity",
      "foreignDemand",
      "resourcePrice",
      "riskPremium",
      "weather",
    ] as const;
    const parsed = {} as Record<(typeof fields)[number], number>;
    for (const field of fields) {
      const value = values[field];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Invalid Nation industry loading ${id}.${field}`);
      }
      parsed[field] = value;
    }
    shares[id] = share;
    loadings[id] = parsed;
  }
  const shareTotal = INDUSTRY_IDS.reduce((sum, id) => sum + shares[id], 0);
  if (Math.abs(shareTotal - 1) > 1e-10) {
    throw new Error(
      `Nation industry shares must sum to one; got ${shareTotal}`,
    );
  }
  return { shares, loadings };
}

function source(
  id: string,
  confidence: CausalRef["confidence"] = "medium",
): CausalRef {
  return {
    sourceType: "inertia",
    sourceId: id,
    labelKey: `model.${id}`,
    confidence,
  };
}

function matchingEffects(
  all: readonly ScheduledEffect[],
  month: number,
  target: string,
  before: number,
): Term[] {
  const out: Term[] = [];
  for (const effect of all) {
    if (
      effect.targetPath !== target ||
      month < effect.startMonth ||
      month > effect.endMonth
    )
      continue;
    const weight = effect.weights[month - effect.startMonth] ?? 0;
    if (!Number.isFinite(weight) || weight === 0) continue;
    const strength = effect.baseStrength * weight;
    const delta =
      effect.operation === "addDelta"
        ? strength
        : effect.operation === "addRate"
          ? before * strength
          : before * (strength - 1);
    out.push({
      source: {
        sourceType: effect.sourceType,
        sourceId: effect.sourceId,
        effectId: effect.effectId,
        labelKey: effect.labelKey,
        confidence: "high",
      },
      delta,
    });
  }
  return out;
}

function build(
  id: CausalMetricId,
  before: number,
  terms: readonly Term[],
  minimum?: number,
  maximum?: number,
): { readonly value: number; readonly causal: CausalContribution } {
  const builder = createContributionBuilder(id, before);
  for (const term of terms) builder.add(term.source, term.delta);
  builder.clamp(minimum, maximum);
  const causal = builder.build();
  return { value: causal.afterValue, causal };
}

function configuredBaselinePublicInvestment(
  snapshot: ConfigSnapshot,
  fallback: number,
): number {
  const nation = snapshot.normalizedConfig.nation;
  if (!nation || typeof nation !== "object" || Array.isArray(nation))
    return fallback;
  const initial = (nation as { readonly initial?: unknown }).initial;
  if (!initial || typeof initial !== "object" || Array.isArray(initial))
    return fallback;
  const value = (initial as { readonly publicInvestment?: unknown })
    .publicInvestment;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return fallback;
  return value;
}

function recentReversalCount(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError("recentPolicyReversals must be a nonnegative integer");
  }
  return value;
}

export function deriveRiskPremium(
  economy: EconomyState,
  config: ConfigSnapshot,
): number {
  const values = parameters(config);
  const debtThreshold = parameter(values, "DEBT-RISK-001");
  const debtGap = Math.max(
    0,
    economy.ratios.governmentDebtRatio - debtThreshold,
  );
  const trustShortfallInTens = Math.max(
    0,
    (50 - economy.sentiment.policyTrust) / 10,
  );
  return (
    parameter(values, "RISK-DEBT-001") * debtGap +
    parameter(values, "DEBT-RISK-002") * trustShortfallInTens
  );
}

function maturationWeight(age: number, start: number, end: number): number {
  if (age <= start) return 0;
  return Math.min(1, (age - start) / (end - start));
}

function maturedPublicCapital(
  history: readonly number[],
  start: number,
  end: number,
  depreciation: number,
): number {
  let total = 0;
  for (let index = 0; index < history.length; index += 1) {
    const age = history.length - index - 1;
    total +=
      history[index]! *
      maturationWeight(age, start, end) *
      (1 - depreciation) ** age;
  }
  return Math.max(0, total);
}

export function getLongTermHooks(
  economy: EconomyState,
  config: ConfigSnapshot,
  publicInvestmentPotentialEffect = 0,
): LongTermHooks {
  const values = parameters(config);
  const infrastructureAverage =
    (economy.infrastructure.transport +
      economy.infrastructure.energy +
      economy.infrastructure.digital +
      economy.infrastructure.water +
      economy.infrastructure.publicFacilities) /
    5;
  return {
    populationGrowthAnnual: parameter(values, "LT-POP-001"),
    productivityGrowthAnnual: parameter(values, "CORE-GROW-001"),
    infrastructureContributionAnnual:
      parameter(values, "LT-INFRA-001") * (infrastructureAverage / 100 - 1),
    publicInvestmentPotentialEffect,
  };
}

export function updateFiscalIndustries(
  input: FiscalIndustryInput,
): FiscalIndustryOutput {
  const values = parameters(input.configSnapshot);
  const economyBefore = input.economy;
  const industryModel = nationIndustryModel(input.configSnapshot);
  const outputGap =
    economyBefore.indices.realGdp / economyBefore.indices.potentialGdp - 1;
  const debtPremium = deriveRiskPremium(economyBefore, input.configSnapshot);
  const debtExcess = Math.max(
    0,
    economyBefore.ratios.governmentDebtRatio -
      parameter(values, "DEBT-RISK-001"),
  );
  const publicInvestmentDebtFactor = Math.max(
    0,
    1 - parameter(values, "PINV-DEBT-001") * debtExcess,
  );

  const tax = build(
    "taxRevenue",
    economyBefore.flows.taxRevenue,
    [
      {
        source: source("FISC-TAX-ELAS-001"),
        delta:
          (economyBefore.flows.taxRevenue *
            parameter(values, "FISC-TAX-ELAS-001") *
            outputGap) /
          12,
      },
      ...matchingEffects(
        input.effects,
        input.monthIndex,
        "economy.flows.taxRevenue",
        economyBefore.flows.taxRevenue,
      ),
    ],
    0,
  );

  const baselinePublicInvestment = configuredBaselinePublicInvestment(
    input.configSnapshot,
    economyBefore.flows.publicInvestment,
  );
  const additionalPublicInvestment =
    economyBefore.flows.publicInvestment - baselinePublicInvestment;
  const projectLoad =
    (Math.max(0, additionalPublicInvestment) /
      Math.max(economyBefore.indices.realGdp, 1e-9)) *
    100;
  const availableImplementationCapacity =
    economyBefore.institutions.implementationCapacity *
    parameter(values, "PINV-CAP-001");
  const implementationFactor =
    projectLoad > 0 && projectLoad > availableImplementationCapacity
      ? availableImplementationCapacity / projectLoad
      : 1;
  const capacityFactor = implementationFactor * publicInvestmentDebtFactor;
  const overrunShare =
    projectLoad > availableImplementationCapacity && projectLoad > 0
      ? (projectLoad - availableImplementationCapacity) / projectLoad
      : 0;
  const overrunCost =
    Math.max(0, additionalPublicInvestment) *
    overrunShare *
    (parameter(values, "PINV-OVR-001") - 1);

  const spendingTerms = matchingEffects(
    input.effects,
    input.monthIndex,
    "economy.flows.primarySpending",
    economyBefore.flows.primarySpending,
  );
  if (overrunCost > 0) {
    spendingTerms.push({
      source: source("public-investment-cost-overrun", "high"),
      delta: overrunCost,
    });
  }
  const spending = build(
    "primarySpending",
    economyBefore.flows.primarySpending,
    spendingTerms,
    0,
  );

  const primaryBalanceValue = tax.value - spending.value;
  const primaryBalance = build(
    "primaryBalance",
    economyBefore.flows.primaryBalance ??
      economyBefore.flows.taxRevenue - economyBefore.flows.primarySpending,
    [
      {
        source: source("tax-balance"),
        delta: tax.value - economyBefore.flows.taxRevenue,
      },
      {
        source: source("primary-spending-balance"),
        delta: -(spending.value - economyBefore.flows.primarySpending),
      },
    ],
  );

  const previousDebtRate =
    economyBefore.memory?.effectiveDebtRateAnnual ??
    (economyBefore.stocks.governmentDebt > 0
      ? (economyBefore.flows.interestPayment * 12) /
        economyBefore.stocks.governmentDebt
      : economyBefore.rates.marketRate);
  const repricingShare = parameter(values, "DEBT-REPRICE-001");
  const riskPremium = debtPremium;
  const effectiveDebtRate =
    previousDebtRate +
    repricingShare *
      (economyBefore.rates.marketRate + riskPremium - previousDebtRate);
  const expectedInterest =
    (economyBefore.stocks.governmentDebt * effectiveDebtRate) / 12;
  const interest = build(
    "interestPayment",
    economyBefore.flows.interestPayment,
    [
      {
        source: source("debt-rate-carry"),
        delta:
          (economyBefore.stocks.governmentDebt * previousDebtRate) / 12 -
          economyBefore.flows.interestPayment,
      },
      {
        source: source("market-rate-repricing", "high"),
        delta:
          (economyBefore.stocks.governmentDebt *
            repricingShare *
            (economyBefore.rates.marketRate - previousDebtRate)) /
          12,
      },
      {
        source: source("debt-risk-premium", "high"),
        delta:
          (economyBefore.stocks.governmentDebt * repricingShare * riskPremium) /
          12,
      },
    ],
    0,
  );
  if (Math.abs(interest.value - expectedInterest) > 1e-9) {
    throw new Error(
      "Interest payment contributions do not reconcile to the effective debt rate",
    );
  }

  const priorFx =
    economyBefore.memory?.previousFxIndex ?? economyBefore.indices.fx;
  const valuationAdjustmentValue =
    economyBefore.stocks.externalGovernmentDebt *
    (economyBefore.indices.fx / Math.max(priorFx, 1e-9) - 1);
  const valuationAdjustment = build(
    "debtValuationAdjustment",
    economyBefore.flows.debtValuationAdjustment ?? 0,
    [
      {
        source: source("external-debt-fx-valuation", "high"),
        delta:
          valuationAdjustmentValue -
          (economyBefore.flows.debtValuationAdjustment ?? 0),
      },
    ],
  );

  const debt = build(
    "governmentDebt",
    economyBefore.stocks.governmentDebt,
    [
      {
        source: source("primary-deficit", "high"),
        delta: -primaryBalanceValue,
      },
      { source: source("debt-interest", "high"), delta: interest.value },
      {
        source: source("external-debt-valuation", "high"),
        delta: valuationAdjustment.value,
      },
    ],
    0,
  );
  const externalDebt = Math.max(
    0,
    Math.min(
      debt.value,
      economyBefore.stocks.externalGovernmentDebt + valuationAdjustment.value,
    ),
  );
  const domesticDebt = debt.value - externalDebt;
  const monthlyNominalGdp = Math.max(
    1e-9,
    economyBefore.indices.realGdp * (economyBefore.indices.cpi / 100),
  );
  const annualNominalGdp = monthlyNominalGdp * 12;
  const debtRatioValue = debt.value / annualNominalGdp;
  const fiscalBalanceValue =
    (primaryBalanceValue - interest.value) / monthlyNominalGdp;
  const debtRatio = build(
    "governmentDebtRatio",
    economyBefore.ratios.governmentDebtRatio,
    [
      {
        source: source("debt-stock-flow", "high"),
        delta:
          (debt.value - economyBefore.stocks.governmentDebt) / annualNominalGdp,
      },
      {
        source: source("nominal-gdp-denominator"),
        delta:
          debtRatioValue -
          economyBefore.ratios.governmentDebtRatio -
          (debt.value - economyBefore.stocks.governmentDebt) / annualNominalGdp,
      },
    ],
  );
  const fiscalBalance = build(
    "fiscalBalanceRatio",
    economyBefore.ratios.fiscalBalanceRatio,
    [
      {
        source: source("tax-balance"),
        delta: (tax.value - economyBefore.flows.taxRevenue) / monthlyNominalGdp,
      },
      {
        source: source("primary-spending-balance"),
        delta:
          -(spending.value - economyBefore.flows.primarySpending) /
          monthlyNominalGdp,
      },
      {
        source: source("interest-balance"),
        delta:
          -(interest.value - economyBefore.flows.interestPayment) /
          monthlyNominalGdp,
      },
      {
        source: source("fiscal-base-and-denominator"),
        delta:
          fiscalBalanceValue -
          economyBefore.ratios.fiscalBalanceRatio -
          (tax.value - economyBefore.flows.taxRevenue) / monthlyNominalGdp +
          (spending.value - economyBefore.flows.primarySpending) /
            monthlyNominalGdp +
          (interest.value - economyBefore.flows.interestPayment) /
            monthlyNominalGdp,
      },
    ],
  );

  const reversals = recentReversalCount(input.recentPolicyReversals);
  const crisisSeverity = Math.max(
    0,
    (economyBefore.external.disasterAlert - 20) / 80,
  );
  const inflationGap = Math.abs(
    economyBefore.rates.inflationAnnual - parameter(values, "CORE-INF-001"),
  );
  const trustTerms: Term[] = [
    {
      source: source("TRUST-MR-001"),
      delta:
        parameter(values, "TRUST-MR-001") *
        (parameter(values, "TRUST-ANCHOR-001") -
          economyBefore.sentiment.policyTrust),
    },
    {
      source: source("TRUST-STAB-001"),
      delta:
        inflationGap <= 0.01
          ? parameter(values, "TRUST-STAB-001")
          : (-parameter(values, "TRUST-INF-001") * (inflationGap - 0.01)) / 12,
    },
    {
      source: source("TRUST-U-001"),
      delta:
        (-parameter(values, "TRUST-U-001") *
          Math.max(
            0,
            economyBefore.rates.unemployment - parameter(values, "CORE-U-001"),
          )) /
        12,
    },
    {
      source: source("TRUST-DEBT-001"),
      delta:
        (-parameter(values, "TRUST-DEBT-001") *
          Math.max(0, debtRatioValue - parameter(values, "DEBT-RISK-001"))) /
        12,
    },
    {
      source: source("TRUST-REV-001", "high"),
      delta: parameter(values, "TRUST-REV-001") * reversals,
    },
    {
      source: source("TRUST-CRISIS-001", "high"),
      delta: -parameter(values, "TRUST-CRISIS-001") * crisisSeverity,
    },
    ...matchingEffects(
      input.effects,
      input.monthIndex,
      "economy.sentiment.policyTrust",
      economyBefore.sentiment.policyTrust,
    ),
  ];
  const trust = build(
    "policyTrust",
    economyBefore.sentiment.policyTrust,
    trustTerms,
    0,
    100,
  );
  const political = build(
    "politicalCapital",
    economyBefore.institutions.politicalCapital,
    [
      {
        source: source("POLCAP-TRUST-001"),
        delta:
          (parameter(values, "POLCAP-TRUST-001") * (trust.value - 50)) / 12,
      },
      ...matchingEffects(
        input.effects,
        input.monthIndex,
        "economy.institutions.politicalCapital",
        economyBefore.institutions.politicalCapital,
      ),
    ],
    0,
    100,
  );
  const implementationCapacity = build(
    "implementationCapacity",
    economyBefore.institutions.implementationCapacity,
    [
      {
        source: source("IMPL-REGEN-001"),
        delta: parameter(values, "IMPL-REGEN-001"),
      },
      ...matchingEffects(
        input.effects,
        input.monthIndex,
        "economy.institutions.implementationCapacity",
        economyBefore.institutions.implementationCapacity,
      ),
    ],
    0,
    100,
  );

  const depreciationRate = parameter(values, "SUP-DEPR-001");
  const capitalFormation =
    (additionalPublicInvestment / annualNominalGdp) *
    parameter(values, "PINV-EFF-001") *
    capacityFactor;
  // The program's direct capital supply follows its ScheduledEffect kernel.
  // Keep only other investment formation in the legacy vintage path so the
  // same spending does not raise potential GDP twice.
  const directPolicyInvestment = matchingEffects(
    input.effects,
    input.monthIndex,
    "economy.flows.publicInvestment",
    economyBefore.flows.publicInvestment,
  ).reduce((sum, term) => sum + term.delta, 0);
  const vintageFormation = Math.max(
    0,
    capitalFormation -
      (directPolicyInvestment / annualNominalGdp) *
        parameter(values, "PINV-EFF-001") *
        capacityFactor,
  );
  const capitalDepreciation =
    economyBefore.stocks.publicCapital * depreciationRate;
  const previousCapital = economyBefore.stocks.publicCapital;
  const publicCapital = build(
    "publicCapital",
    previousCapital,
    [
      {
        source: source("public-investment-capital-formation", "high"),
        delta: capitalFormation,
      },
      {
        source: source("public-capital-depreciation"),
        delta: -capitalDepreciation,
      },
    ],
    0,
  );
  const lagStart = parameter(values, "PINV-SUPPLY-LAG-START-001");
  const lagEnd = parameter(values, "PINV-SUPPLY-LAG-END-001");
  if (
    !Number.isInteger(lagStart) ||
    !Number.isInteger(lagEnd) ||
    lagStart >= lagEnd
  ) {
    throw new RangeError(
      "Public-investment supply lag must satisfy integer start < end",
    );
  }
  const previousHistory =
    economyBefore.memory?.publicCapitalFormationHistory ?? [];
  const publicCapitalHistory = [...previousHistory, vintageFormation].slice(
    -(lagEnd + 1),
  );
  const maturedCapital = maturedPublicCapital(
    publicCapitalHistory,
    lagStart,
    lagEnd,
    depreciationRate,
  );
  const referenceFormation = parameter(values, "PINV-EFF-001") * 0.01;
  const potentialEffect =
    referenceFormation > 0
      ? (maturedCapital / referenceFormation) *
        parameter(values, "PINV-SUPPLY-001")
      : 0;
  const baselinePotentialGdp =
    economyBefore.memory?.baselinePotentialGdp ??
    economyBefore.indices.potentialGdp;
  const activePolicyPotential = input.effects
    .filter((effect) => effect.targetPath === "economy.indices.potentialGdp")
    .reduce((sum, effect) => {
      const delivered = Math.min(
        effect.weights.length,
        Math.max(0, input.monthIndex - effect.startMonth + 1),
      );
      return (
        sum +
        effect.baseStrength *
          effect.weights
            .slice(0, delivered)
            .reduce((total, weight) => total + weight, 0)
      );
    }, 0);
  const policyPotential =
    (economyBefore.memory?.completedPolicyPotential ?? 0) +
    activePolicyPotential;
  const potentialGdp =
    baselinePotentialGdp * (1 + potentialEffect) + policyPotential;
  if (!Number.isFinite(potentialGdp) || potentialGdp <= 0) {
    throw new Error(
      "Public-investment supply effect produced invalid potential GDP",
    );
  }
  const policyPotentialTerms = matchingEffects(
    input.effects,
    input.monthIndex,
    "economy.indices.potentialGdp",
    economyBefore.indices.potentialGdp,
  );
  const scheduledDelta = policyPotentialTerms.reduce(
    (sum, term) => sum + term.delta,
    0,
  );
  const potentialGdpCausal = build(
    "potentialGdp",
    economyBefore.indices.potentialGdp,
    [
      ...policyPotentialTerms,
      {
        source: source("public-capital-vintages", "high"),
        delta:
          potentialGdp - economyBefore.indices.potentialGdp - scheduledDelta,
      },
    ],
  );

  const industryRaw: Record<IndustryId, number> = {} as Record<
    IndustryId,
    number
  >;
  const industryTerms: Record<IndustryId, readonly Term[]> = {} as Record<
    IndustryId,
    readonly Term[]
  >;
  const employmentRaw: Record<IndustryId, number> = {} as Record<
    IndustryId,
    number
  >;
  const previousResourcePriceIndex =
    economyBefore.memory?.previousResourcePriceIndex ??
    economyBefore.external.resourcePriceIndex;
  const resourcePriceGrowth =
    economyBefore.external.resourcePriceIndex /
      Math.max(previousResourcePriceIndex, 1e-9) -
    1;
  const foreignGrowthGap =
    economyBefore.external.foreignGrowthAnnual -
    parameter(values, "EXT-GROW-001");
  const weatherSeverity = Math.max(
    0,
    (economyBefore.external.disasterAlert -
      parameter(values, "IND-WEATHER-ANCHOR-001")) /
      parameter(values, "IND-WEATHER-RANGE-001"),
  );
  for (const id of INDUSTRY_IDS) {
    const industry = economyBefore.industries[id];
    const loading = industryModel.loadings[id];
    const terms: Term[] = [
      {
        source: source("industry-domestic-demand"),
        delta:
          (industry.productionIndex *
            parameter(values, "IND-GDP-001") *
            loading.domesticDemand *
            outputGap) /
          12,
      },
      {
        source: source("industry-productivity"),
        delta:
          (industry.productionIndex *
            parameter(values, "CORE-GROW-001") *
            loading.productivity) /
          12,
      },
      {
        source: source("industry-world-demand", "high"),
        delta:
          (industry.productionIndex *
            loading.foreignDemand *
            foreignGrowthGap) /
          12,
      },
      {
        source: source("industry-resource-price", "high"),
        delta:
          industry.productionIndex *
          loading.resourcePrice *
          resourcePriceGrowth,
      },
      {
        source: source("industry-risk-premium", "high"),
        delta:
          (industry.productionIndex * loading.riskPremium * riskPremium) / 12,
      },
      {
        source: source("industry-weather", "high"),
        delta:
          (industry.productionIndex * loading.weather * weatherSeverity) / 12,
      },
      ...matchingEffects(
        input.effects,
        input.monthIndex,
        `economy.industries.${id}.productionIndex`,
        industry.productionIndex,
      ),
    ];
    const raw = Math.max(
      1,
      industry.productionIndex +
        terms.reduce((sum, term) => sum + term.delta, 0),
    );
    industryRaw[id] = raw;
    industryTerms[id] = terms;
    const relativeGrowth = raw / industry.productionIndex - 1 - outputGap / 12;
    employmentRaw[id] = Math.max(
      Number.MIN_VALUE,
      industry.employmentShare *
        (1 + parameter(values, "IND-EMP-ADJ-001") * relativeGrowth),
    );
  }
  const employmentTotal = INDUSTRY_IDS.reduce(
    (sum, id) => sum + employmentRaw[id],
    0,
  );
  if (!Number.isFinite(employmentTotal) || employmentTotal <= 0) {
    throw new Error("Industry employment allocation became invalid");
  }

  const rawWeightedProduction = INDUSTRY_IDS.reduce(
    (sum, id) => sum + industryRaw[id] * industryModel.shares[id],
    0,
  );
  if (!Number.isFinite(rawWeightedProduction) || rawWeightedProduction <= 0) {
    throw new Error("Industry production aggregate became invalid");
  }
  const previousWeightedProduction = INDUSTRY_IDS.reduce(
    (sum, id) =>
      sum +
      economyBefore.industries[id].productionIndex * industryModel.shares[id],
    0,
  );
  const industryAggregateResidual = build("industryAggregateResidual", 0, [
    {
      source: source("industry-initial-aggregate-gap", "high"),
      delta: previousWeightedProduction - economyBefore.indices.realGdp,
    },
    ...INDUSTRY_IDS.map((id) => ({
      source: source(`industry.${id}.pre-reconciliation`, "high"),
      delta:
        (industryRaw[id] - economyBefore.industries[id].productionIndex) *
        industryModel.shares[id],
    })),
  ]);
  if (
    Math.abs(
      industryAggregateResidual.value -
        (rawWeightedProduction - economyBefore.indices.realGdp),
    ) > 1e-9
  ) {
    throw new Error(
      "Industry aggregate residual contributions do not reconcile",
    );
  }
  const productionScale = economyBefore.indices.realGdp / rawWeightedProduction;
  const industryCausal: CausalContribution[] = [];
  const industries = {} as Record<IndustryId, IndustryState>;
  const publicInvestmentCapacityFlow =
    (Math.max(0, economyBefore.flows.publicInvestment) / annualNominalGdp) *
    parameter(values, "PINV-EFF-001") *
    100;

  for (const id of INDUSTRY_IDS) {
    const before = economyBefore.industries[id];
    const productionValue = industryRaw[id] * productionScale;
    const employmentValue = employmentRaw[id] / employmentTotal;
    const productionTerms = [...industryTerms[id]];
    if (productionValue !== industryRaw[id]) {
      productionTerms.push({
        source: source("industry-aggregate-reconciliation", "high"),
        delta: productionValue - industryRaw[id],
      });
    }
    const production = build(
      `industry.${id}.production`,
      before.productionIndex,
      productionTerms,
      1,
    );
    const employment = build(
      `industry.${id}.employment`,
      before.employmentShare,
      [
        {
          source: source("industry-employment-reallocation"),
          delta: employmentValue - before.employmentShare,
        },
      ],
      0,
      1,
    );

    const relativeImportPrice =
      Math.max(1, economyBefore.indices.importPrice) /
      Math.max(1, before.priceIndex);
    const targetImportDependency = Math.max(
      0,
      Math.min(
        1,
        before.importDependency *
          Math.exp(
            -parameter(values, "IND-IMP-ELAS-001") *
              Math.log(relativeImportPrice),
          ),
      ),
    );
    const importTargetDelta =
      parameter(values, "IND-IMP-ADJ-001") *
      (targetImportDependency - before.importDependency);
    const importTerms: Term[] = [
      {
        source: source("industry-import-substitution"),
        delta: importTargetDelta,
      },
      ...matchingEffects(
        input.effects,
        input.monthIndex,
        `economy.industries.${id}.importDependency`,
        before.importDependency,
      ),
    ];
    const importDependency = build(
      `industry.${id}.importDependency`,
      before.importDependency,
      importTerms,
      0,
      1,
    );

    const industryCapitalFormation =
      publicInvestmentCapacityFlow * industryModel.shares[id];
    const capacityAdjustment =
      parameter(values, "IND-CAP-001") *
      (production.value - before.capacityIndex);
    const baselineCapacityGrowth =
      (before.capacityIndex * parameter(values, "CORE-GROW-001")) / 12;
    const capacityDepreciation = before.capacityIndex * depreciationRate;
    const capacityTerms: Term[] = [
      {
        source: source("industry-capacity-adjustment"),
        delta: capacityAdjustment,
      },
      {
        source: source("public-investment-capacity-formation"),
        delta: industryCapitalFormation,
      },
      {
        source: source("baseline-productivity-capacity-growth"),
        delta: baselineCapacityGrowth,
      },
      {
        source: source("industry-capacity-depreciation"),
        delta: -capacityDepreciation,
      },
      ...matchingEffects(
        input.effects,
        input.monthIndex,
        `economy.industries.${id}.capacityIndex`,
        before.capacityIndex,
      ),
    ];
    const capacity = build(
      `industry.${id}.capacity`,
      before.capacityIndex,
      capacityTerms,
      1,
    );
    const priceIndex = Math.max(
      1,
      before.priceIndex * (1 + economyBefore.rates.inflationAnnual / 12),
    );
    industries[id] = {
      productionIndex: indexLevel(production.value),
      employmentShare: share01(employment.value),
      capacityIndex: indexLevel(capacity.value),
      importDependency: share01(importDependency.value),
      priceIndex: indexLevel(priceIndex),
    };
    industryCausal.push(
      production.causal,
      employment.causal,
      importDependency.causal,
      capacity.causal,
    );
  }

  const aggregateProduction = INDUSTRY_IDS.reduce(
    (sum, id) =>
      sum + industries[id].productionIndex * industryModel.shares[id],
    0,
  );
  if (Math.abs(aggregateProduction - economyBefore.indices.realGdp) > 1e-9) {
    throw new Error(
      "Weighted six-industry production does not reconcile to real GDP",
    );
  }

  const economy: EconomyState = {
    ...economyBefore,
    indices: {
      ...economyBefore.indices,
      potentialGdp: indexLevel(potentialGdp),
    },
    memory: {
      ...economyBefore.memory,
      previousFxIndex: indexLevel(economyBefore.indices.fx),
      previousResourcePriceIndex: indexLevel(
        economyBefore.external.resourcePriceIndex,
      ),
      effectiveDebtRateAnnual: percentRate(effectiveDebtRate),
      baselinePotentialGdp: indexLevel(baselinePotentialGdp),
      publicCapitalFormationHistory: publicCapitalHistory,
      completedPolicyPotential:
        economyBefore.memory?.completedPolicyPotential ?? 0,
      appliedPolicyPotential: policyPotential,
    },
    flows: {
      ...economyBefore.flows,
      taxRevenue: flowPerMonth(tax.value),
      primarySpending: flowPerMonth(spending.value),
      primaryBalance: flowPerMonth(primaryBalance.value),
      interestPayment: flowPerMonth(interest.value),
      debtValuationAdjustment: flowPerMonth(valuationAdjustment.value),
    },
    stocks: {
      ...economyBefore.stocks,
      governmentDebt: stockLevel(debt.value),
      domesticGovernmentDebt: stockLevel(domesticDebt),
      externalGovernmentDebt: stockLevel(externalDebt),
      publicCapital: stockLevel(publicCapital.value),
    },
    ratios: {
      governmentDebtRatio: percentRate(debtRatio.value),
      fiscalBalanceRatio: percentRate(fiscalBalance.value),
    },
    sentiment: {
      ...economyBefore.sentiment,
      policyTrust: scorePoint(trust.value),
    },
    institutions: {
      ...economyBefore.institutions,
      politicalCapital: scorePoint(political.value),
      implementationCapacity: scorePoint(implementationCapacity.value),
    },
    industries,
  };
  const longTermHooks = getLongTermHooks(
    economy,
    input.configSnapshot,
    potentialEffect + policyPotential / baselinePotentialGdp,
  );
  return {
    economy,
    causal: [
      tax.causal,
      spending.causal,
      primaryBalance.causal,
      interest.causal,
      valuationAdjustment.causal,
      debt.causal,
      debtRatio.causal,
      fiscalBalance.causal,
      trust.causal,
      political.causal,
      implementationCapacity.causal,
      publicCapital.causal,
      potentialGdpCausal.causal,
      industryAggregateResidual.causal,
      ...industryCausal,
    ],
    longTermHooks,
    industryAggregateResidual: industryAggregateResidual.value,
  };
}

export const updateFiscalIndustriesStage: TickStageHandler = ({
  state,
  context,
}) => {
  const recentCancellations = state.policies.cancelled.filter(
    (policy) =>
      policy.decidedMonth <= state.monthIndex &&
      state.monthIndex - policy.decidedMonth < 6,
  ).length;
  const result = updateFiscalIndustries({
    economy: state.economy,
    effects: state.effects,
    monthIndex: state.monthIndex,
    configSnapshot: context.configSnapshot,
    recentPolicyReversals: recentCancellations,
  });
  const next: GameState = {
    ...state,
    economy: result.economy,
    resources: {
      ...state.resources,
      politicalCapital: result.economy.institutions.politicalCapital,
      implementationCapacity:
        result.economy.institutions.implementationCapacity,
    },
  };
  return {
    state: next,
    causal: result.causal,
    metrics: {
      "fiscal.primaryBalance": result.economy.flows.primaryBalance ?? 0,
      "fiscal.debt": result.economy.stocks.governmentDebt,
      "fiscal.debtRiskPremium": deriveRiskPremium(
        result.economy,
        context.configSnapshot,
      ),
      "publicInvestment.capital": result.economy.stocks.publicCapital,
      "publicInvestment.potentialEffect":
        result.longTermHooks.publicInvestmentPotentialEffect,
      "industry.aggregateResidual": result.industryAggregateResidual,
    },
    notes: [
      `longTerm.populationGrowth=${result.longTermHooks.populationGrowthAnnual}`,
      `longTerm.productivityGrowth=${result.longTermHooks.productivityGrowthAnnual}`,
      `longTerm.infrastructure=${result.longTermHooks.infrastructureContributionAnnual}`,
      `longTerm.publicInvestment=${result.longTermHooks.publicInvestmentPotentialEffect}`,
    ],
  };
};
