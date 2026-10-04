import type {
  ForecastRecord,
  GameState,
  LearningEntry,
  MonthlyReportSnapshot,
  NumericUnit,
} from "@macro-nation/domain";
import { indicatorDisplayName } from "@macro-nation/advisor-core";
import { causeCategory } from "./home-view";
import { historyCauseDisplay, historyReferenceDisplay } from "./history";
import schoolLensData from "./school-lenses.json";

export interface SchoolLens {
  readonly schoolId: string;
  readonly displayName: string;
  readonly goals: readonly string[];
  readonly premises: readonly string[];
  readonly view: string;
  readonly benefits: readonly string[];
  readonly risks: readonly string[];
}

export const schoolLenses: readonly SchoolLens[] = schoolLensData.legacy;

export function schoolLensesForContentVersion(
  contentVersion: string,
): readonly SchoolLens[] {
  return contentVersion === "1.2.0" ? schoolLensData["1.2.0"] : schoolLenses;
}

export interface ForecastCapture {
  readonly decisionId: string;
  readonly month: number;
  readonly expertIds: readonly string[];
  readonly confidence: ForecastRecord["confidence"];
  readonly uncertainty: string;
  readonly summaries: readonly {
    readonly horizonMonths: number;
    readonly indicatorId: string;
    readonly endDelta: number;
  }[];
}

export function forecastRecord(capture: ForecastCapture): ForecastRecord {
  const indicatorsFor = (months: 12 | 60) =>
    Object.fromEntries(
      capture.summaries
        .filter((item) => item.horizonMonths === months)
        .map((item) => [item.indicatorId, item.endDelta]),
    );
  return {
    recordId: `forecast:${capture.decisionId}`,
    decisionId: capture.decisionId,
    recordedMonth: capture.month,
    expertIds: [...capture.expertIds],
    confidence: capture.confidence,
    uncertainty: capture.uncertainty,
    horizons: [
      { months: 12, indicators: indicatorsFor(12) },
      { months: 60, indicators: indicatorsFor(60) },
    ],
  };
}

export function visibleCauseCount(
  mode: NonNullable<GameState["learningMode"]>,
): number {
  return mode === "casual" ? 1 : 3;
}

/**
 * Builds notebook records from the durable monthly report. This is deliberately
 * an application-side projection: none of these records can feed the Engine.
 */
export function learningEntriesForReport(
  state: GameState,
  report: MonthlyReportSnapshot,
): readonly LearningEntry[] {
  if (state.learningMode !== "learning" || report.topCauses.length === 0)
    return [];
  const cause = report.topCauses[0]!;
  const decision = [...state.policies.active, ...state.policies.reserved]
    .filter((item) => item.decidedMonth <= report.monthIndex)
    .sort((left, right) => right.decidedMonth - left.decidedMonth)[0];
  const base = `learning:${report.monthIndex}:${cause.indicatorId}:${cause.sourceType}:${cause.sourceId}`;
  const evidence = `${cause.indicatorId} / ${cause.sourceType}:${cause.sourceId} / ${cause.delta >= 0 ? "+" : ""}${cause.delta.toFixed(4)}`;
  const shared = {
    month: report.monthIndex,
    evidence,
    mode: state.learningMode,
    ...(decision ? { decisionId: decision.policyId } : {}),
  } as const;
  return [
    {
      ...shared,
      entryId: `${base}:term`,
      kind: "term",
      concept: cause.indicatorId,
    },
    {
      ...shared,
      entryId: `${base}:theory`,
      kind: "theory",
      concept: `${cause.sourceType}から${cause.indicatorId}への因果経路`,
    },
    {
      ...shared,
      entryId: `${base}:decision`,
      kind: "decision",
      concept: decision ? `政策判断 ${decision.type}` : "無介入の判断",
    },
    {
      ...shared,
      entryId: `${base}:verification`,
      kind: "verification",
      concept: `${report.monthIndex}月目の結果検証`,
    },
  ];
}

const RATE_INDICATORS = new Set([
  "inflation",
  "inflationAnnual",
  "unemployment",
  "policyRate",
  "marketRate",
  "foreignRate",
  "expectedInflation",
  "governmentDebtRatio",
  "fiscalBalanceRatio",
  "currentAccountRatio",
  "outputGap",
]);
const SCORE_INDICATORS = new Set([
  "policyTrust",
  "support",
  "consumerConfidence",
  "businessConfidence",
  "politicalCapital",
  "implementationCapacity",
  "inequality",
  "speculationPressure",
]);
const INDEX_INDICATORS = new Set([
  "realGdp",
  "potentialGdp",
  "cpi",
  "fx",
  "nominalWage",
  "realHouseholdIncome",
  "importPrice",
  "manufacturing",
  "agriculture",
  "transport",
  "energy",
]);
const FLOW_INDICATORS = new Set([
  "consumption",
  "investment",
  "governmentConsumption",
  "publicInvestment",
  "exports",
  "imports",
  "taxRevenue",
  "primarySpending",
  "interestPayment",
  "primaryBalance",
  "debtValuationAdjustment",
  "currentAccount",
  "capitalFlow",
  "foreignReserveChange",
]);
const STOCK_INDICATORS = new Set([
  "governmentDebt",
  "foreignReserves",
  "domesticGovernmentDebt",
  "externalGovernmentDebt",
]);

function contributionDisplay(
  indicatorId: string,
  rawDelta: string,
  state: GameState,
): string {
  const content = state.configSnapshot?.normalizedConfig.content as
    | {
        indicatorDefinitions?: readonly {
          indicatorId: string;
          unit: NumericUnit;
        }[];
      }
    | undefined;
  const configuredUnit = content?.indicatorDefinitions?.find(
    (definition) => definition.indicatorId === indicatorId,
  )?.unit;
  const unit =
    configuredUnit ??
    (RATE_INDICATORS.has(indicatorId) ||
    /^industry\..+\.(employment|importDependency)$/.test(indicatorId)
      ? "PercentRate"
      : SCORE_INDICATORS.has(indicatorId)
        ? "ScorePoint"
        : INDEX_INDICATORS.has(indicatorId) ||
            /^industry\..+\.(production|capacity)$/.test(indicatorId)
          ? "IndexLevel"
          : FLOW_INDICATORS.has(indicatorId)
            ? "FlowPerMonth"
            : STOCK_INDICATORS.has(indicatorId)
              ? "StockLevel"
              : "Scalar");
  const delta = Number(rawDelta);
  if (unit === "PercentRate" || unit === "Share01")
    return `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(4)}パーセントポイント`;
  const suffix: Readonly<Record<NumericUnit, string>> = {
    PercentPoint: "パーセントポイント",
    PercentRate: "パーセントポイント",
    Share01: "パーセントポイント",
    ScorePoint: "ポイント",
    IndexLevel: "指数ポイント",
    LogIndex: "対数指数ポイント",
    FlowPerMonth: "（ゲーム内金額・月間）",
    StockLevel: "（ゲーム内金額）",
    MonthCount: "か月",
    Scalar: "",
  };
  return `${rawDelta}${suffix[unit]}`;
}

/** Translate notebook prose at display time; saved evidence, IDs and precision stay intact. */
export function learningEntryDisplay(
  entry: LearningEntry,
  state: GameState,
): { readonly concept: string; readonly evidence: string } {
  const match =
    /^([^ /]+) \/ (policy|combo|event|external|inertia|random):(.+) \/ ([+-]?\d+(?:\.\d+)?)$/.exec(
      entry.evidence,
    );
  if (!match) {
    return {
      concept: /[\u3040-\u30ff\u3400-\u9fff]/.test(entry.concept)
        ? entry.concept
        : "経済の変化についての記録",
      evidence: /[\u3040-\u30ff\u3400-\u9fff]/.test(entry.evidence)
        ? entry.evidence
        : `${entry.month}月目の結果をもとにした記録です。`,
    };
  }
  const indicatorId = match[1]!;
  const sourceType = match[2]!;
  const sourceId = match[3]!;
  const rawDelta = match[4]!;
  const indicator = indicatorDisplayName(indicatorId);
  const concepts = {
    term: indicator,
    theory: `${causeCategory(sourceType)}が${indicator}に影響する仕組み`,
    decision: entry.decisionId
      ? `${historyReferenceDisplay(entry.decisionId, state)}を選んだ判断`
      : "政策を加えずに見守った判断",
    verification: `${entry.month}月目の結果を振り返る`,
  };
  return {
    concept: concepts[entry.kind],
    evidence: `${entry.month}月目の${indicator}の変化に、${historyCauseDisplay(`${sourceType}:${sourceId}`, state)}が${contributionDisplay(indicatorId, rawDelta, state)}影響しています。`,
  };
}
