import type {
  ForecastRecord,
  GameState,
  LearningEntry,
  MonthlyReportSnapshot,
} from "@macro-nation/domain";
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

export const schoolLenses: readonly SchoolLens[] = schoolLensData;

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
