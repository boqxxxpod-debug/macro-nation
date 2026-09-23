import {
  flowPerMonth,
  indexLevel,
  type CausalContribution,
  type CausalMetricId,
  type CausalRef,
  type ConfigSnapshot,
  type EconomyState,
  type GameState,
  type RngBundle,
  type ScheduledEffect,
} from "@macro-nation/domain";
import { createContributionBuilder } from "./causal";
import type { TickRngProvider, TickStageHandler } from "./tick";

const PARAMETER_IDS = [
  "CORE-GROW-001",
  "CORE-INF-001",
  "CORE-U-001",
  "CORE-R-001",
  "CONS-BASE-001",
  "CONS-Y-001",
  "CONS-R-001",
  "CONS-U-001",
  "CONS-INF-001",
  "CONS-TRUST-001",
  "CONS-ERR-001",
  "INV-BASE-001",
  "INV-GAP-001",
  "INV-PROD-001",
  "INV-R-001",
  "INV-UNC-001",
  "INV-TRUST-001",
  "INV-ERR-001",
  "EXT-GROW-001",
  "X-FOREIGN-001",
  "X-FX-001",
  "X-ERR-001",
  "M-DEMAND-001",
  "M-FX-001",
  "M-ERR-001",
  "IS-GAP-PERSIST-001",
  "IS-GAP-RATE-001",
  "IS-GAP-FISCAL-001",
  "IS-GAP-FOREIGN-001",
  "IS-GAP-FX-001",
  "IS-GAP-CONFIDENCE-001",
  "IS-GAP-ERR-001",
  "IS-GAP-MIN-001",
  "IS-GAP-MAX-001",
  "FISC-G-001",
  "FISC-G-003",
  "FISC-SLACK-THRESHOLD-001",
  "FISC-BOOM-THRESHOLD-001",
  "PINV-DEMAND-001",
  "PINV-SLACK-001",
  "PINV-CAP-001",
  "PINV-DEBT-001",
  "DEBT-RISK-001",
  "PINV-DEMAND-HORIZON-001",
  "GDP-SHARE-C-001",
  "GDP-SHARE-I-001",
  "GDP-SHARE-G-001",
  "GDP-SHARE-X-001",
  "GDP-SHARE-M-001",
] as const;

type DemandParameterId = (typeof PARAMETER_IDS)[number];
type GdpComponentId =
  | "consumption"
  | "investment"
  | "governmentConsumption"
  | "exports"
  | "imports";
type CorrelationComponentId =
  "consumption" | "investment" | "exports" | "imports";

const GDP_COMPONENT_IDS = [
  "consumption",
  "investment",
  "governmentConsumption",
  "exports",
  "imports",
] as const satisfies readonly GdpComponentId[];

const CORRELATION_COMPONENT_IDS = [
  "consumption",
  "investment",
  "exports",
  "imports",
] as const satisfies readonly CorrelationComponentId[];

const GDP_SIGNS: Readonly<Record<GdpComponentId, 1 | -1>> = Object.freeze({
  consumption: 1,
  investment: 1,
  governmentConsumption: 1,
  exports: 1,
  imports: -1,
});

const GDP_SHARE_IDS: Readonly<Record<GdpComponentId, DemandParameterId>> =
  Object.freeze({
    consumption: "GDP-SHARE-C-001",
    investment: "GDP-SHARE-I-001",
    governmentConsumption: "GDP-SHARE-G-001",
    exports: "GDP-SHARE-X-001",
    imports: "GDP-SHARE-M-001",
  });

type ComponentLevels = Readonly<Record<GdpComponentId, number>> & {
  readonly publicInvestment: number;
};
type ComponentGrowth = Readonly<Record<GdpComponentId, number>>;

export interface DemandDiagnostics {
  readonly outputGapBefore: number;
  readonly outputGapAfter: number;
  readonly realGdpMonthlyGrowth: number;
  readonly componentGrowth: ComponentGrowth;
  readonly componentLevels: ComponentLevels;
  readonly compositionScale: number;
}

export interface DemandInput {
  readonly economy: EconomyState;
  readonly effects: readonly ScheduledEffect[];
  readonly monthIndex: number;
  readonly configSnapshot: ConfigSnapshot;
  readonly rng: RngBundle;
  readonly rngProvider: TickRngProvider;
}

export interface DemandOutput {
  readonly economy: EconomyState;
  readonly rng: RngBundle;
  readonly causal: readonly CausalContribution[];
  readonly diagnostics: DemandDiagnostics;
}

export interface DemandBatchObservation {
  readonly realGdp: number;
  readonly outputGap: number;
  readonly components: ComponentLevels;
  readonly realGdpContributions: readonly {
    readonly sourceId: string;
    readonly delta: number;
  }[];
  readonly accountingError: number;
  readonly contributionError: number;
}

export interface DemandBatchStatistic {
  readonly mean: number;
  readonly standardDeviation: number;
}

export interface DemandBatchSummary {
  readonly runCount: number;
  readonly monthsPerRun: number;
  readonly observationCount: number;
  readonly outputGap: DemandBatchStatistic;
  readonly realGdpYearOverYear: DemandBatchStatistic;
  readonly realGdpQuarterlyAnnualized: DemandBatchStatistic;
  readonly componentYearOverYear: Readonly<
    Record<CorrelationComponentId, DemandBatchStatistic>
  >;
  readonly componentQuarterlyAnnualized: Readonly<
    Record<CorrelationComponentId, DemandBatchStatistic>
  >;
  readonly componentYearOverYearContribution: Readonly<
    Record<GdpComponentId, DemandBatchStatistic>
  >;
  readonly componentQuarterlyAnnualizedContribution: Readonly<
    Record<GdpComponentId, DemandBatchStatistic>
  >;
  readonly correlationYearOverYear: Readonly<
    Record<CorrelationComponentId, number>
  >;
  readonly correlationQuarterlyAnnualized: Readonly<
    Record<CorrelationComponentId, number>
  >;
  readonly meanRealGdpContributionBySource: Readonly<Record<string, number>>;
  readonly maxAccountingError: number;
  readonly maxContributionError: number;
  readonly maxComponentContributionError: number;
  readonly maxQuarterlyAggregationError: number;
}

interface DeltaTerm {
  readonly source: CausalRef;
  readonly delta: number;
}

interface ComponentProjection {
  readonly id: GdpComponentId;
  readonly before: number;
  readonly weight: number;
  readonly sign: 1 | -1;
  readonly causal: CausalContribution;
}

function getParameters(
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
  id: DemandParameterId,
): number {
  const value = values[id];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing or invalid demand parameter ${id}`);
  }
  return value;
}

function annualToMonthly(rate: number): number {
  if (rate <= -1)
    throw new RangeError("annual rate must be greater than -100%");
  return Math.pow(1 + rate, 1 / 12) - 1;
}

function persistenceSum(persistence: number, horizon: number): number {
  if (
    !Number.isFinite(persistence) ||
    persistence < 0 ||
    persistence >= 1 ||
    !Number.isInteger(horizon) ||
    horizon <= 0
  ) {
    throw new RangeError("Public-investment response calibration is invalid");
  }
  let total = 0;
  for (let month = 0; month < horizon; month += 1) {
    total += persistence ** month;
  }
  return total;
}

function configuredBaselinePublicInvestment(
  snapshot: ConfigSnapshot,
  fallback: number,
): number {
  const nation = snapshot.normalizedConfig.nation;
  if (!nation || typeof nation !== "object" || Array.isArray(nation)) {
    return fallback;
  }
  const initial = (nation as { readonly initial?: unknown }).initial;
  if (!initial || typeof initial !== "object" || Array.isArray(initial)) {
    return fallback;
  }
  const value = (initial as { readonly publicInvestment?: unknown })
    .publicInvestment;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function macroSource(
  sourceId: string,
  confidence: CausalRef["confidence"] = "medium",
): CausalRef {
  return {
    sourceType: "inertia",
    sourceId,
    labelKey: `model.${sourceId}`,
    confidence,
  };
}

function scheduledTerms(
  effects: readonly ScheduledEffect[],
  monthIndex: number,
  targetPath: string,
  before: number,
): DeltaTerm[] {
  const terms: DeltaTerm[] = [];
  for (const effect of effects) {
    if (
      effect.targetPath !== targetPath ||
      monthIndex < effect.startMonth ||
      monthIndex > effect.endMonth
    ) {
      continue;
    }
    const weight = effect.weights[monthIndex - effect.startMonth] ?? 0;
    if (!Number.isFinite(weight) || weight === 0) continue;
    const strength = effect.baseStrength * weight;
    const delta =
      effect.operation === "addDelta" ? strength : before * strength;
    terms.push({
      source: {
        sourceType: effect.sourceType,
        sourceId: effect.sourceId,
        labelKey: effect.labelKey,
        confidence: "high",
      },
      delta,
    });
  }
  return terms;
}

function buildComponent(
  metricId: CausalMetricId,
  before: number,
  terms: readonly DeltaTerm[],
) {
  const builder = createContributionBuilder(metricId, before);
  for (const term of terms) builder.add(term.source, term.delta);
  builder.clamp(0);
  const causal = builder.build();
  return { value: causal.afterValue, causal };
}

function assertGdpShares(p: Readonly<Record<string, number>>): void {
  const shares = Object.values(GDP_SHARE_IDS).map((id) => parameter(p, id));
  if (shares.some((share) => share < 0 || share > 1)) {
    throw new RangeError("GDP shares must be between zero and one");
  }
  const [consumption, investment, government, exports, imports] = shares;
  const identity =
    consumption! + investment! + government! + exports! - imports!;
  if (Math.abs(identity - 1) > 1e-10) {
    throw new Error("GDP shares must satisfy C + I + G + X - M = 1");
  }
}

function netGdpDelta(projections: readonly ComponentProjection[]): number {
  return projections.reduce(
    (sum, projection) =>
      sum +
      projection.sign * (projection.causal.afterValue - projection.before),
    0,
  );
}

function compositionScale(
  projections: readonly ComponentProjection[],
  preliminaryNetDelta: number,
  targetNetDelta: number,
): { readonly scale: number; readonly adjustments: readonly number[] } {
  const adjustments = projections.map(
    (projection) =>
      projection.causal.afterValue -
      projection.before -
      projection.weight * preliminaryNetDelta,
  );

  let lower = 0;
  let upper = 1;
  for (let index = 0; index < projections.length; index += 1) {
    const projection = projections[index]!;
    const baseline = projection.before + projection.weight * targetNetDelta;
    const adjustment = adjustments[index]!;
    if (adjustment > 0) {
      lower = Math.max(lower, -baseline / adjustment);
    } else if (adjustment < 0) {
      upper = Math.min(upper, baseline / -adjustment);
    } else if (baseline < 0) {
      throw new RangeError(
        "GDP loading would make a demand component negative",
      );
    }
  }

  lower = Math.max(0, lower);
  upper = Math.min(1, upper);
  if (lower > upper + 1e-12 || upper < 0) {
    throw new RangeError(
      "GDP loadings cannot preserve nonnegative demand components",
    );
  }
  return { scale: Math.max(lower, upper), adjustments };
}

function buildLoadedComponents(
  projections: readonly ComponentProjection[],
  outputGap: CausalContribution,
  potentialGdp: number,
  targetNetDelta: number,
  preliminaryNetDelta: number,
): {
  readonly scale: number;
  readonly values: Readonly<Record<GdpComponentId, number>>;
  readonly causal: readonly CausalContribution[];
} {
  const { scale, adjustments } = compositionScale(
    projections,
    preliminaryNetDelta,
    targetNetDelta,
  );
  const outputGapTerms = outputGap.contributions;
  const causal: CausalContribution[] = [];
  const values = {} as Record<GdpComponentId, number>;

  for (
    let targetIndex = 0;
    targetIndex < projections.length;
    targetIndex += 1
  ) {
    const target = projections[targetIndex]!;
    const builder = createContributionBuilder(target.id, target.before);

    for (const origin of projections) {
      for (const term of origin.causal.contributions) {
        if (origin.id === target.id) {
          builder.add(term, scale * term.delta);
        }
        builder.add(term, -scale * target.weight * origin.sign * term.delta);
      }
    }

    for (const term of outputGapTerms) {
      builder.add(term, target.weight * potentialGdp * term.delta);
    }

    const afterValue =
      target.before +
      target.weight * targetNetDelta +
      scale * adjustments[targetIndex]!;
    values[target.id] = Math.max(0, afterValue);
    causal.push(builder.build(values[target.id]));
  }

  return { scale, values, causal };
}

function growth(after: number, before: number): number {
  return before === 0 ? 0 : after / before - 1;
}

function mean(values: readonly number[]): number {
  if (values.length === 0)
    throw new RangeError("Cannot summarize an empty series");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      values.length,
  );
}

function statistic(values: readonly number[]): DemandBatchStatistic {
  return { mean: mean(values), standardDeviation: standardDeviation(values) };
}

function pearsonCorrelation(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length !== right.length || left.length < 2) {
    throw new RangeError(
      "Correlation needs two aligned series with at least two values",
    );
  }
  const leftMean = mean(left);
  const rightMean = mean(right);
  let covariance = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDifference = left[index]! - leftMean;
    const rightDifference = right[index]! - rightMean;
    covariance += leftDifference * rightDifference;
    leftSquares += leftDifference * leftDifference;
    rightSquares += rightDifference * rightDifference;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator === 0 ? 0 : covariance / denominator;
}

export function updateDemandAndGdp(input: DemandInput): DemandOutput {
  const p = getParameters(input.configSnapshot);
  for (const id of PARAMETER_IDS) parameter(p, id);
  assertGdpShares(p);

  const e = input.economy;
  const gdpBefore = e.indices.realGdp;
  const potentialGdp = e.indices.potentialGdp;
  if (gdpBefore <= 0 || !Number.isFinite(gdpBefore)) {
    throw new RangeError("real GDP must be finite and greater than zero");
  }
  if (potentialGdp <= 0 || !Number.isFinite(potentialGdp)) {
    throw new RangeError("potential GDP must be finite and greater than zero");
  }

  const outputGapBefore = gdpBefore / potentialGdp - 1;
  const realRateGap =
    e.rates.marketRate - e.rates.expectedInflation - parameter(p, "CORE-R-001");
  const unemploymentGap = e.rates.unemployment - parameter(p, "CORE-U-001");
  const inflationGap = e.rates.inflationAnnual - parameter(p, "CORE-INF-001");
  const incomeGap = e.indices.realHouseholdIncome / 100 - 1;
  const trustGap = (e.sentiment.policyTrust - 50) / 100;
  const uncertainty = e.sentiment.speculationPressure / 100;
  const fxGap = e.indices.fx / e.indices.cpi - 1;
  const foreignGrowthGap =
    e.external.foreignGrowthAnnual - parameter(p, "EXT-GROW-001");
  const confidenceGap =
    (e.sentiment.consumerConfidence + e.sentiment.businessConfidence - 100) /
    100;

  let rng = input.rng;
  const gapDraw = input.rngProvider.drawFloat01(rng, "error.outputGap");
  rng = gapDraw.bundle;
  const cDraw = input.rngProvider.drawFloat01(rng, "error.consumption");
  rng = cDraw.bundle;
  const iDraw = input.rngProvider.drawFloat01(rng, "error.investment");
  rng = iDraw.bundle;
  const xDraw = input.rngProvider.drawFloat01(rng, "error.exports");
  rng = xDraw.bundle;
  const mDraw = input.rngProvider.drawFloat01(rng, "error.imports");
  rng = mDraw.bundle;

  const c0 = e.flows.consumption;
  const i0 = e.flows.investment;
  const g0 = e.flows.governmentConsumption;
  const x0 = e.flows.exports;
  const m0 = e.flows.imports;
  const publicInvestment0 = configuredBaselinePublicInvestment(
    input.configSnapshot,
    e.flows.publicInvestment,
  );
  const cError =
    Math.sqrt(3) * parameter(p, "CONS-ERR-001") * (2 * cDraw.value - 1);
  const iError =
    Math.sqrt(3) * parameter(p, "INV-ERR-001") * (2 * iDraw.value - 1);
  const xError =
    Math.sqrt(3) * parameter(p, "X-ERR-001") * (2 * xDraw.value - 1);
  const mError =
    Math.sqrt(3) * parameter(p, "M-ERR-001") * (2 * mDraw.value - 1);

  const consumption = buildComponent("consumption", c0, [
    {
      source: macroSource("CONS-BASE-001", "high"),
      delta: c0 * annualToMonthly(parameter(p, "CONS-BASE-001")),
    },
    {
      source: macroSource("CONS-Y-001"),
      delta: (c0 * parameter(p, "CONS-Y-001") * incomeGap) / 12,
    },
    {
      source: macroSource("CONS-R-001"),
      delta: (-c0 * parameter(p, "CONS-R-001") * realRateGap) / 12,
    },
    {
      source: macroSource("CONS-U-001"),
      delta: (-c0 * parameter(p, "CONS-U-001") * unemploymentGap) / 12,
    },
    {
      source: macroSource("CONS-INF-001"),
      delta: (-c0 * parameter(p, "CONS-INF-001") * inflationGap) / 12,
    },
    {
      source: macroSource("CONS-TRUST-001"),
      delta: (c0 * parameter(p, "CONS-TRUST-001") * trustGap) / 12,
    },
    {
      source: {
        sourceType: "random",
        sourceId: "error.consumption",
        labelKey: "random.consumption",
        confidence: "low",
      },
      delta: c0 * cError,
    },
    ...scheduledTerms(
      input.effects,
      input.monthIndex,
      "economy.flows.consumption",
      c0,
    ),
  ]);

  const investment = buildComponent("investment", i0, [
    {
      source: macroSource("INV-BASE-001", "high"),
      delta: i0 * annualToMonthly(parameter(p, "INV-BASE-001")),
    },
    {
      source: macroSource("INV-GAP-001"),
      delta: (i0 * parameter(p, "INV-GAP-001") * outputGapBefore) / 12,
    },
    {
      source: macroSource("INV-PROD-001"),
      delta:
        (i0 * parameter(p, "INV-PROD-001") * parameter(p, "CORE-GROW-001")) /
        12,
    },
    {
      source: macroSource("INV-R-001"),
      delta: (-i0 * parameter(p, "INV-R-001") * realRateGap) / 12,
    },
    {
      source: macroSource("INV-UNC-001"),
      delta: (-i0 * parameter(p, "INV-UNC-001") * uncertainty) / 12,
    },
    {
      source: macroSource("INV-TRUST-001"),
      delta: (i0 * parameter(p, "INV-TRUST-001") * trustGap) / 12,
    },
    {
      source: {
        sourceType: "random",
        sourceId: "error.investment",
        labelKey: "random.investment",
        confidence: "low",
      },
      delta: i0 * iError,
    },
    ...scheduledTerms(
      input.effects,
      input.monthIndex,
      "economy.flows.investment",
      i0,
    ),
  ]);

  const government = buildComponent(
    "governmentConsumption",
    g0,
    scheduledTerms(
      input.effects,
      input.monthIndex,
      "economy.flows.governmentConsumption",
      g0,
    ),
  );

  const exports = buildComponent("exports", x0, [
    {
      source: {
        sourceType: "external",
        sourceId: "foreign-growth",
        labelKey: "external.foreignGrowth",
        confidence: "medium",
      },
      delta: (x0 * parameter(p, "X-FOREIGN-001") * foreignGrowthGap) / 12,
    },
    {
      source: {
        sourceType: "external",
        sourceId: "real-fx-gap",
        labelKey: "external.fx",
        confidence: "medium",
      },
      delta: (x0 * parameter(p, "X-FX-001") * fxGap) / 12,
    },
    {
      source: {
        sourceType: "random",
        sourceId: "error.exports",
        labelKey: "random.exports",
        confidence: "low",
      },
      delta: x0 * xError,
    },
    ...scheduledTerms(
      input.effects,
      input.monthIndex,
      "economy.flows.exports",
      x0,
    ),
  ]);

  const imports = buildComponent("imports", m0, [
    {
      source: macroSource("M-DEMAND-001"),
      delta: (m0 * parameter(p, "M-DEMAND-001") * outputGapBefore) / 12,
    },
    {
      source: {
        sourceType: "external",
        sourceId: "real-fx-gap",
        labelKey: "external.fx",
        confidence: "medium",
      },
      delta: (m0 * parameter(p, "M-FX-001") * fxGap) / 12,
    },
    {
      source: {
        sourceType: "random",
        sourceId: "error.imports",
        labelKey: "random.imports",
        confidence: "low",
      },
      delta: m0 * mError,
    },
    ...scheduledTerms(
      input.effects,
      input.monthIndex,
      "economy.flows.imports",
      m0,
    ),
  ]);

  const publicInvestmentTerms = scheduledTerms(
    input.effects,
    input.monthIndex,
    "economy.flows.publicInvestment",
    publicInvestment0,
  );
  const publicInvestment = buildComponent(
    "publicInvestment",
    publicInvestment0,
    publicInvestmentTerms,
  );

  const projections: readonly ComponentProjection[] = [
    {
      id: "consumption",
      before: c0,
      weight: parameter(p, GDP_SHARE_IDS.consumption),
      sign: GDP_SIGNS.consumption,
      causal: consumption.causal,
    },
    {
      id: "investment",
      before: i0,
      weight: parameter(p, GDP_SHARE_IDS.investment),
      sign: GDP_SIGNS.investment,
      causal: investment.causal,
    },
    {
      id: "governmentConsumption",
      before: g0,
      weight: parameter(p, GDP_SHARE_IDS.governmentConsumption),
      sign: GDP_SIGNS.governmentConsumption,
      causal: government.causal,
    },
    {
      id: "exports",
      before: x0,
      weight: parameter(p, GDP_SHARE_IDS.exports),
      sign: GDP_SIGNS.exports,
      causal: exports.causal,
    },
    {
      id: "imports",
      before: m0,
      weight: parameter(p, GDP_SHARE_IDS.imports),
      sign: GDP_SIGNS.imports,
      causal: imports.causal,
    },
  ];

  const governmentFiscalTerms = scheduledTerms(
    input.effects,
    input.monthIndex,
    "economy.flows.governmentConsumption",
    g0,
  );
  const gapMinimum = parameter(p, "IS-GAP-MIN-001");
  const gapMaximum = parameter(p, "IS-GAP-MAX-001");
  if (gapMinimum <= -1 || gapMinimum >= gapMaximum) {
    throw new RangeError("Output-gap bounds must satisfy -1 < min < max");
  }

  const outputGapBuilder = createContributionBuilder(
    "outputGap",
    outputGapBefore,
  );
  outputGapBuilder.add(
    macroSource("IS-GAP-PERSIST-001", "high"),
    (parameter(p, "IS-GAP-PERSIST-001") - 1) * outputGapBefore,
  );
  outputGapBuilder.add(
    macroSource("IS-GAP-RATE-001"),
    (-parameter(p, "IS-GAP-RATE-001") * realRateGap) / 12,
  );
  for (const term of governmentFiscalTerms) {
    outputGapBuilder.add(
      term.source,
      parameter(p, "IS-GAP-FISCAL-001") *
        (term.delta / Math.max(gdpBefore, 1e-9)),
    );
  }
  const demandHorizon = parameter(p, "PINV-DEMAND-HORIZON-001");
  const persistenceResponse = persistenceSum(
    parameter(p, "IS-GAP-PERSIST-001"),
    demandHorizon,
  );
  const importDependency = Object.values(e.industries).reduce(
    (sum, industry) =>
      sum + industry.employmentShare * industry.importDependency,
    0,
  );
  const slackThreshold = parameter(p, "FISC-SLACK-THRESHOLD-001");
  const boomThreshold = parameter(p, "FISC-BOOM-THRESHOLD-001");
  const publicInvestmentRegimeMultiplier =
    outputGapBefore <= slackThreshold
      ? parameter(p, "PINV-SLACK-001")
      : outputGapBefore >= boomThreshold
        ? parameter(p, "FISC-G-003") / parameter(p, "FISC-G-001")
        : parameter(p, "FISC-G-001");
  for (const term of publicInvestmentTerms) {
    const projectLoad =
      (Math.max(0, term.delta) / Math.max(gdpBefore, 1e-9)) * 100;
    const availableCapacity =
      e.institutions.implementationCapacity * parameter(p, "PINV-CAP-001");
    const capacityFactor =
      projectLoad > 0 && projectLoad > availableCapacity
        ? availableCapacity / projectLoad
        : 1;
    const debtFactor = Math.max(
      0,
      1 -
        parameter(p, "PINV-DEBT-001") *
          Math.max(
            0,
            e.ratios.governmentDebtRatio - parameter(p, "DEBT-RISK-001"),
          ),
    );
    outputGapBuilder.add(
      term.source,
      ((parameter(p, "PINV-DEMAND-001") *
        (term.delta / Math.max(gdpBefore, 1e-9))) /
        0.01 /
        persistenceResponse) *
        publicInvestmentRegimeMultiplier *
        (1 - importDependency) *
        capacityFactor *
        debtFactor,
    );
  }
  outputGapBuilder.add(
    {
      sourceType: "external",
      sourceId: "foreign-growth",
      labelKey: "external.foreignGrowth",
      confidence: "medium",
    },
    (parameter(p, "IS-GAP-FOREIGN-001") * foreignGrowthGap) / 12,
  );
  outputGapBuilder.add(
    {
      sourceType: "external",
      sourceId: "real-fx-gap",
      labelKey: "external.fx",
      confidence: "medium",
    },
    parameter(p, "IS-GAP-FX-001") * fxGap,
  );
  outputGapBuilder.add(
    {
      sourceType: "external",
      sourceId: "confidence-composite",
      labelKey: "sentiment.confidence",
      confidence: "medium",
    },
    (parameter(p, "IS-GAP-CONFIDENCE-001") * confidenceGap) / 12,
  );
  outputGapBuilder.add(
    {
      sourceType: "random",
      sourceId: "error.outputGap",
      labelKey: "random.outputGap",
      confidence: "low",
    },
    Math.sqrt(3) * parameter(p, "IS-GAP-ERR-001") * (2 * gapDraw.value - 1),
  );
  outputGapBuilder.clamp(gapMinimum, gapMaximum);
  const outputGapCausal = outputGapBuilder.build();
  const outputGapAfter = outputGapCausal.afterValue;
  const targetGdp = potentialGdp * (1 + outputGapAfter);
  const componentGdpBefore = c0 + i0 + g0 + x0 - m0;
  const targetNetDelta = targetGdp - componentGdpBefore;
  const preliminaryNetDelta = netGdpDelta(projections);

  const loaded = buildLoadedComponents(
    projections,
    outputGapCausal,
    potentialGdp,
    targetNetDelta,
    preliminaryNetDelta,
  );
  const gdpBuilder = createContributionBuilder("realGdp", gdpBefore);
  for (let index = 0; index < loaded.causal.length; index += 1) {
    const componentCausal = loaded.causal[index]!;
    const componentId = projections[index]!.id;
    const sign = GDP_SIGNS[componentId];
    for (const term of componentCausal.contributions) {
      gdpBuilder.add(term, sign * term.delta);
    }
  }
  const realGdpCausal = gdpBuilder.build(targetGdp);

  const levels: ComponentLevels = {
    consumption: loaded.values.consumption,
    investment: loaded.values.investment,
    governmentConsumption: loaded.values.governmentConsumption,
    exports: loaded.values.exports,
    imports: loaded.values.imports,
    publicInvestment: publicInvestment.value,
  };
  const economy: EconomyState = {
    ...e,
    indices: {
      ...e.indices,
      realGdp: indexLevel(realGdpCausal.afterValue),
    },
    flows: {
      ...e.flows,
      consumption: flowPerMonth(levels.consumption),
      investment: flowPerMonth(levels.investment),
      governmentConsumption: flowPerMonth(levels.governmentConsumption),
      publicInvestment: flowPerMonth(levels.publicInvestment),
      exports: flowPerMonth(levels.exports),
      imports: flowPerMonth(levels.imports),
    },
  };

  return {
    economy,
    rng,
    causal: [
      ...loaded.causal,
      publicInvestment.causal,
      outputGapCausal,
      realGdpCausal,
    ],
    diagnostics: {
      outputGapBefore,
      outputGapAfter,
      realGdpMonthlyGrowth: growth(economy.indices.realGdp, gdpBefore),
      componentGrowth: {
        consumption: growth(levels.consumption, c0),
        investment: growth(levels.investment, i0),
        governmentConsumption: growth(levels.governmentConsumption, g0),
        exports: growth(levels.exports, x0),
        imports: growth(levels.imports, m0),
      },
      componentLevels: levels,
      compositionScale: loaded.scale,
    },
  };
}

export function createDemandBatchObservation(
  output: DemandOutput,
): DemandBatchObservation {
  let contributionError = 0;
  const realGdpContributions = new Map<string, number>();
  for (const contribution of output.causal) {
    const sum = contribution.contributions.reduce(
      (total, term) => total + term.delta,
      0,
    );
    contributionError = Math.max(
      contributionError,
      Math.abs(sum - contribution.totalDelta),
    );
    if (contribution.indicatorId === "realGdp") {
      for (const term of contribution.contributions) {
        if (Math.abs(term.delta) < 1e-14) continue;
        realGdpContributions.set(
          term.sourceId,
          (realGdpContributions.get(term.sourceId) ?? 0) + term.delta,
        );
      }
    }
  }
  const components = output.diagnostics.componentLevels;
  return {
    realGdp: output.economy.indices.realGdp,
    outputGap: output.diagnostics.outputGapAfter,
    components,
    realGdpContributions: [...realGdpContributions.entries()].map(
      ([sourceId, delta]) => ({ sourceId, delta }),
    ),
    accountingError: Math.abs(
      components.consumption +
        components.investment +
        components.governmentConsumption +
        components.exports -
        components.imports -
        output.economy.indices.realGdp,
    ),
    contributionError,
  };
}

export function summarizeDemandBatch(
  runs: readonly (readonly DemandBatchObservation[])[],
  warmupMonths = 12,
): DemandBatchSummary {
  if (runs.length === 0)
    throw new RangeError("Demand batch must contain at least one run");
  if (!Number.isInteger(warmupMonths) || warmupMonths < 0) {
    throw new RangeError("warmupMonths must be a nonnegative integer");
  }
  const monthsPerRun = runs[0]!.length;
  if (monthsPerRun <= warmupMonths + 12) {
    throw new RangeError("Demand runs must include warmup plus 13 months");
  }
  if (runs.some((run) => run.length !== monthsPerRun)) {
    throw new RangeError("Demand runs must have the same number of months");
  }

  const outputGaps: number[] = [];
  const gdpYearOverYear: number[] = [];
  const gdpQuarterlyAnnualized: number[] = [];
  const componentYearOverYear = Object.fromEntries(
    CORRELATION_COMPONENT_IDS.map((id) => [id, [] as number[]]),
  ) as Record<CorrelationComponentId, number[]>;
  const componentQuarterlyAnnualized = Object.fromEntries(
    CORRELATION_COMPONENT_IDS.map((id) => [id, [] as number[]]),
  ) as Record<CorrelationComponentId, number[]>;
  const componentYearOverYearContributionValues = Object.fromEntries(
    GDP_COMPONENT_IDS.map((id) => [id, [] as number[]]),
  ) as Record<GdpComponentId, number[]>;
  const componentQuarterlyAnnualizedContributionValues = Object.fromEntries(
    GDP_COMPONENT_IDS.map((id) => [id, [] as number[]]),
  ) as Record<GdpComponentId, number[]>;
  const gdpYearOverYearForCorrelation: number[] = [];
  const gdpQuarterlyForCorrelation: number[] = [];
  const componentYearOverYearForCorrelation = Object.fromEntries(
    CORRELATION_COMPONENT_IDS.map((id) => [id, [] as number[]]),
  ) as Record<CorrelationComponentId, number[]>;
  const componentQuarterlyForCorrelation = Object.fromEntries(
    CORRELATION_COMPONENT_IDS.map((id) => [id, [] as number[]]),
  ) as Record<CorrelationComponentId, number[]>;
  const contributionSums = new Map<string, number>();
  let maxAccountingError = 0;
  let maxContributionError = 0;
  let maxComponentContributionError = 0;
  let maxQuarterlyAggregationError = 0;
  let observationCount = 0;

  for (const run of runs) {
    const gdp = run.map((sample) => sample.realGdp);
    const componentSeries = Object.fromEntries(
      GDP_COMPONENT_IDS.map((id) => [
        id,
        run.map((sample) => sample.components[id]),
      ]),
    ) as Record<GdpComponentId, number[]>;
    for (let month = warmupMonths; month < run.length; month += 1) {
      const sample = run[month]!;
      outputGaps.push(sample.outputGap);
      observationCount += 1;
      maxAccountingError = Math.max(maxAccountingError, sample.accountingError);
      maxContributionError = Math.max(
        maxContributionError,
        sample.contributionError,
      );
      for (const term of sample.realGdpContributions) {
        contributionSums.set(
          term.sourceId,
          (contributionSums.get(term.sourceId) ?? 0) + term.delta,
        );
      }

      if (month >= Math.max(12, warmupMonths)) {
        const gdpGrowth = gdp[month]! / gdp[month - 12]! - 1;
        gdpYearOverYear.push(gdpGrowth);
        gdpYearOverYearForCorrelation.push(gdpGrowth);
        for (const id of CORRELATION_COMPONENT_IDS) {
          const componentGrowth =
            componentSeries[id][month]! / componentSeries[id][month - 12]! - 1;
          componentYearOverYear[id].push(componentGrowth);
          componentYearOverYearForCorrelation[id].push(componentGrowth);
        }

        let componentContributionSum = 0;
        for (const id of GDP_COMPONENT_IDS) {
          const contribution =
            (GDP_SIGNS[id] *
              (componentSeries[id][month]! -
                componentSeries[id][month - 12]!)) /
            gdp[month - 12]!;
          componentContributionSum += contribution;
          componentYearOverYearContributionValues[id].push(contribution);
        }
        maxComponentContributionError = Math.max(
          maxComponentContributionError,
          Math.abs(componentContributionSum - gdpGrowth),
        );
      }

      if (month >= 3) {
        const directQuarterly = Math.pow(gdp[month]! / gdp[month - 3]!, 4) - 1;
        const chainedQuarterly =
          Math.pow(
            (gdp[month - 2]! / gdp[month - 3]!) *
              (gdp[month - 1]! / gdp[month - 2]!) *
              (gdp[month]! / gdp[month - 1]!),
            4,
          ) - 1;
        maxQuarterlyAggregationError = Math.max(
          maxQuarterlyAggregationError,
          Math.abs(directQuarterly - chainedQuarterly),
        );
        if (month >= warmupMonths) {
          gdpQuarterlyAnnualized.push(directQuarterly);
          gdpQuarterlyForCorrelation.push(directQuarterly);
          for (const id of CORRELATION_COMPONENT_IDS) {
            const componentGrowth =
              Math.pow(
                componentSeries[id][month]! / componentSeries[id][month - 3]!,
                4,
              ) - 1;
            componentQuarterlyAnnualized[id].push(componentGrowth);
            componentQuarterlyForCorrelation[id].push(componentGrowth);
          }

          const quarterlySimpleGrowth = gdp[month]! / gdp[month - 3]! - 1;
          const annualizationFactor =
            Math.abs(quarterlySimpleGrowth) < 1e-12
              ? 4
              : directQuarterly / quarterlySimpleGrowth;
          let componentContributionSum = 0;
          for (const id of GDP_COMPONENT_IDS) {
            const contribution =
              ((GDP_SIGNS[id] *
                (componentSeries[id][month]! -
                  componentSeries[id][month - 3]!)) /
                gdp[month - 3]!) *
              annualizationFactor;
            componentContributionSum += contribution;
            componentQuarterlyAnnualizedContributionValues[id].push(
              contribution,
            );
          }
          maxComponentContributionError = Math.max(
            maxComponentContributionError,
            Math.abs(componentContributionSum - directQuarterly),
          );
        }
      }
    }
  }

  const correlationYearOverYear = {} as Record<CorrelationComponentId, number>;
  const correlationQuarterlyAnnualized = {} as Record<
    CorrelationComponentId,
    number
  >;
  const componentYearOverYearStats = {} as Record<
    CorrelationComponentId,
    DemandBatchStatistic
  >;
  const componentQuarterlyStats = {} as Record<
    CorrelationComponentId,
    DemandBatchStatistic
  >;
  const componentYearOverYearContributionStats = {} as Record<
    GdpComponentId,
    DemandBatchStatistic
  >;
  const componentQuarterlyContributionStats = {} as Record<
    GdpComponentId,
    DemandBatchStatistic
  >;
  for (const id of CORRELATION_COMPONENT_IDS) {
    correlationYearOverYear[id] = pearsonCorrelation(
      gdpYearOverYearForCorrelation,
      componentYearOverYearForCorrelation[id],
    );
    correlationQuarterlyAnnualized[id] = pearsonCorrelation(
      gdpQuarterlyForCorrelation,
      componentQuarterlyForCorrelation[id],
    );
    componentYearOverYearStats[id] = statistic(componentYearOverYear[id]);
    componentQuarterlyStats[id] = statistic(componentQuarterlyAnnualized[id]);
  }
  for (const id of GDP_COMPONENT_IDS) {
    componentYearOverYearContributionStats[id] = statistic(
      componentYearOverYearContributionValues[id],
    );
    componentQuarterlyContributionStats[id] = statistic(
      componentQuarterlyAnnualizedContributionValues[id],
    );
  }

  const meanRealGdpContributionBySource = Object.fromEntries(
    [...contributionSums.entries()].map(([sourceId, sum]) => [
      sourceId,
      sum / observationCount,
    ]),
  );

  return {
    runCount: runs.length,
    monthsPerRun,
    observationCount,
    outputGap: statistic(outputGaps),
    realGdpYearOverYear: statistic(gdpYearOverYear),
    realGdpQuarterlyAnnualized: statistic(gdpQuarterlyAnnualized),
    componentYearOverYear: componentYearOverYearStats,
    componentQuarterlyAnnualized: componentQuarterlyStats,
    componentYearOverYearContribution: componentYearOverYearContributionStats,
    componentQuarterlyAnnualizedContribution:
      componentQuarterlyContributionStats,
    correlationYearOverYear,
    correlationQuarterlyAnnualized,
    meanRealGdpContributionBySource,
    maxAccountingError,
    maxContributionError,
    maxComponentContributionError,
    maxQuarterlyAggregationError,
  };
}

export const updateDemandStage: TickStageHandler = ({ state, context }) => {
  const result = updateDemandAndGdp({
    economy: state.economy,
    effects: state.effects,
    monthIndex: state.monthIndex,
    configSnapshot: context.configSnapshot,
    rng: state.rng,
    rngProvider: context.rngProvider,
  });
  const next: GameState = {
    ...state,
    economy: result.economy,
    rng: result.rng,
  };
  const components = result.diagnostics.componentLevels;
  return {
    state: next,
    causal: result.causal,
    metrics: {
      "demand.outputGap": result.diagnostics.outputGapAfter,
      "demand.realGdp": result.economy.indices.realGdp,
      "demand.realGdpMonthlyGrowth": result.diagnostics.realGdpMonthlyGrowth,
      "demand.consumption": components.consumption,
      "demand.investment": components.investment,
      "demand.governmentConsumption": components.governmentConsumption,
      "demand.exports": components.exports,
      "demand.imports": components.imports,
      "demand.publicInvestment": components.publicInvestment,
      "demand.consumptionGrowth":
        result.diagnostics.componentGrowth.consumption,
      "demand.investmentGrowth": result.diagnostics.componentGrowth.investment,
      "demand.governmentConsumptionGrowth":
        result.diagnostics.componentGrowth.governmentConsumption,
      "demand.exportsGrowth": result.diagnostics.componentGrowth.exports,
      "demand.importsGrowth": result.diagnostics.componentGrowth.imports,
    },
    notes: [
      `demand.outputGap=${result.diagnostics.outputGapAfter}`,
      `demand.realGdpMonthlyGrowth=${result.diagnostics.realGdpMonthlyGrowth}`,
    ],
  };
};
