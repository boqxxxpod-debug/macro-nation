import type {
  ForecastRecord,
  GameState,
  LearningEntry,
  MonthlyReportSnapshot,
  NumericUnit,
} from "@macro-nation/domain";
import {
  indicatorDisplayName,
  renderContent,
} from "@macro-nation/advisor-core";
import { historyCauseDisplay, historyReferenceDisplay } from "./history";
import learningContentData from "./learning-content.json";
import schoolLensData from "./school-lenses.json";

interface LearningContent {
  readonly templates: Readonly<Record<string, string>>;
  readonly kindLabels: Readonly<Record<LearningEntry["kind"], string>>;
  readonly sourceCategories: Readonly<Record<string, string>>;
  readonly unitSuffixes: Readonly<Record<NumericUnit, string>>;
  readonly unknownConcept: string;
  readonly unknownEvidence: string;
  readonly unknownCauseCategory: string;
}

function learningContentForVersion(contentVersion: string): LearningContent {
  return contentVersion === "1.3.0"
    ? learningContentData["1.3.0"]
    : learningContentData.legacy;
}

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
  return contentVersion === "1.2.0" || contentVersion === "1.3.0"
    ? schoolLensData["1.2.0"]
    : schoolLenses;
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
  // Completed/cancelled decisions can still explain a delayed report effect.
  // A recent, unrelated policy is never evidence for a non-policy cause.
  const decision =
    cause.sourceType === "policy"
      ? [
          ...state.policies.active,
          ...state.policies.reserved,
          ...(state.policies.completed ?? []),
          ...(state.policies.cancelled ?? []),
        ].find(
          (item) =>
            item.policyId === cause.sourceId &&
            item.decidedMonth <= report.monthIndex,
        )
      : undefined;
  const base = `learning:${report.monthIndex}:${cause.indicatorId}:${cause.sourceType}:${cause.sourceId}`;
  const shared = {
    month: report.monthIndex,
    contentVersion: state.versions?.contentVersion ?? "1.3.0",
    evidenceKey: "learning.evidence.contribution",
    cause: { ...cause },
    mode: state.learningMode,
    ...(decision ? { decisionId: decision.policyId } : {}),
  } as const;
  return [
    {
      ...shared,
      entryId: `${base}:term`,
      kind: "term",
      conceptKey: "learning.term",
    },
    {
      ...shared,
      entryId: `${base}:theory`,
      kind: "theory",
      conceptKey: "learning.theory",
    },
    {
      ...shared,
      entryId: `${base}:decision`,
      kind: "decision",
      conceptKey: decision
        ? "learning.decision.policy"
        : cause.sourceType === "policy"
          ? "learning.decision.unresolvedPolicy"
          : "learning.decision.otherCause",
    },
    {
      ...shared,
      entryId: `${base}:verification`,
      kind: "verification",
      conceptKey: "learning.verification",
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
  delta: number,
  state: GameState,
  content: LearningContent,
): string {
  const snapshotContent = state.configSnapshot?.normalizedConfig.content as
    | {
        indicatorDefinitions?: readonly {
          indicatorId: string;
          unit: NumericUnit;
        }[];
      }
    | undefined;
  const configuredUnit = snapshotContent?.indicatorDefinitions?.find(
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
  const displayDelta =
    unit === "PercentRate" || unit === "Share01" ? delta * 100 : delta;
  return `${displayDelta >= 0 ? "+" : ""}${displayDelta.toFixed(4)}${content.unitSuffixes[unit]}`;
}

/** Read structured notebooks and legacy prose without mutating saved evidence. */
export function learningEntryDisplay(
  entry: LearningEntry,
  state: GameState,
): {
  readonly concept: string;
  readonly evidence: string;
  readonly kindLabel: string;
} {
  const content = learningContentForVersion(
    entry.contentVersion ?? state.versions?.contentVersion ?? "legacy",
  );
  const match =
    /^([^ /]+) \/ (policy|combo|event|external|inertia|random):(.+) \/ ([+-]?\d+(?:\.\d+)?)$/.exec(
      entry.evidence ?? "",
    );
  const cause =
    entry.cause ??
    (match
      ? {
          indicatorId: match[1]!,
          sourceType: match[2]!,
          sourceId: match[3]!,
          delta: Number(match[4]),
        }
      : undefined);
  if (!cause) {
    return {
      kindLabel: content.kindLabels[entry.kind],
      concept:
        entry.concept && /[\u3040-\u30ff\u3400-\u9fff]/.test(entry.concept)
          ? entry.concept
          : content.unknownConcept,
      evidence:
        entry.evidence && /[\u3040-\u30ff\u3400-\u9fff]/.test(entry.evidence)
          ? entry.evidence
          : renderContent(content.unknownEvidence, {
              month: String(entry.month),
            }),
    };
  }
  const values = {
    month: String(entry.month),
    indicator: indicatorDisplayName(cause.indicatorId),
    sourceCategory:
      content.sourceCategories[cause.sourceType] ??
      content.unknownCauseCategory,
    cause: historyCauseDisplay(`${cause.sourceType}:${cause.sourceId}`, state),
    decision: entry.decisionId
      ? historyReferenceDisplay(entry.decisionId, state)
      : "",
    contribution: contributionDisplay(
      cause.indicatorId,
      cause.delta,
      state,
      content,
    ),
  };
  const legacyConceptKeys = {
    term: "learning.term",
    theory: "learning.theory",
    decision: entry.decisionId
      ? "learning.decision.policy"
      : "learning.decision.legacyObservation",
    verification: "learning.verification",
  };
  return {
    kindLabel: content.kindLabels[entry.kind],
    concept: renderContent(
      content.templates[entry.conceptKey ?? legacyConceptKeys[entry.kind]] ??
        content.unknownConcept,
      values,
    ),
    evidence: renderContent(
      content.templates[
        entry.evidenceKey ?? "learning.evidence.contribution"
      ] ?? content.unknownEvidence,
      values,
    ),
  };
}
