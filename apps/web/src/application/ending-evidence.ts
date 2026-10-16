import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";
import {
  selectReportCauses,
  type MonthlyEvidenceTarget,
  type ReportCause,
} from "./monthly-evidence";

export interface EndingChange {
  readonly indicatorId: string;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  /** A saved month's evidence for this indicator, not a whole-period cause. */
  readonly target: MonthlyEvidenceTarget;
  readonly evidenceMissing?: "cause";
}

export interface EndingFinalMonth {
  readonly report?: MonthlyReportSnapshot;
  readonly cause?: ReportCause;
  readonly target?: MonthlyEvidenceTarget;
  readonly completeness?: "complete" | "legacy-incomplete" | "initial";
  readonly missing?: "report" | "cause";
}

export interface EndingEvidence {
  readonly period: {
    readonly startMonthIndex: 0;
    readonly endMonthIndex: number;
  };
  readonly initialReport?: MonthlyReportSnapshot;
  readonly finalReport?: MonthlyReportSnapshot;
  readonly largestChange?: EndingChange;
  readonly finalMonth: EndingFinalMonth;
  readonly missing?: "initial-report" | "final-report" | "comparable-values";
}

function sameCause(left: ReportCause, right: ReportCause): boolean {
  return (
    left.indicatorId === right.indicatorId &&
    left.sourceType === right.sourceType &&
    left.sourceId === right.sourceId &&
    left.labelKey === right.labelKey &&
    left.delta === right.delta
  );
}

/** Retain the existing summary choice without ranking unlike units again. */
function finalMonthEvidence(
  state: GameState,
  report?: MonthlyReportSnapshot,
): EndingFinalMonth {
  if (!report) return { missing: "report" };
  const completeness = report.causalTrace?.completeness ?? "legacy-incomplete";
  const summary = report.topCauses.find((cause) =>
    Number.isFinite(cause.delta),
  );
  let cause = summary;
  if (completeness === "complete") {
    const matching = summary
      ? selectReportCauses(state, {
          monthIndex: report.monthIndex,
          indicatorId: summary.indicatorId,
        }).causes.filter((item) => Number.isFinite(item.delta))
      : [];
    cause =
      matching.find((item) => summary && sameCause(item, summary)) ??
      matching[0];
    if (!cause) {
      for (const stage of report.causalTrace!.indicators) {
        const term = stage.contributions.find((item) =>
          Number.isFinite(item.delta),
        );
        if (!term) continue;
        cause = {
          indicatorId: stage.indicatorId,
          sourceType: term.sourceType,
          sourceId: term.sourceId,
          labelKey: term.labelKey,
          delta: term.delta,
        };
        break;
      }
    }
  } else if (completeness === "initial") {
    cause = undefined;
  }
  const indicatorId =
    cause?.indicatorId ??
    Object.entries(report.values).find(([, value]) =>
      Number.isFinite(value),
    )?.[0] ??
    (completeness === "complete"
      ? report.causalTrace?.indicators[0]?.indicatorId
      : undefined);
  return {
    report,
    completeness,
    ...(cause ? { cause } : { missing: "cause" as const }),
    ...(indicatorId
      ? {
          target: {
            monthIndex: report.monthIndex,
            indicatorId,
            row: 0 as const,
          },
        }
      : {}),
  };
}

/** Compare saved endpoints; monthly causes remain separate, dated evidence. */
export function selectEndingEvidence(state: GameState): EndingEvidence {
  const reports = state.history.reports ?? [];
  const initialReport = reports.find((report) => report.monthIndex === 0);
  const finalReport = reports.find(
    (report) => report.monthIndex === state.monthIndex,
  );
  const selected = {
    period: { startMonthIndex: 0 as const, endMonthIndex: state.monthIndex },
    ...(initialReport ? { initialReport } : {}),
    ...(finalReport ? { finalReport } : {}),
    finalMonth: finalMonthEvidence(state, finalReport),
  };
  if (!initialReport) return { ...selected, missing: "initial-report" };
  if (!finalReport) return { ...selected, missing: "final-report" };
  if (state.monthIndex === 0)
    return { ...selected, missing: "comparable-values" };

  const change = Object.entries(finalReport.values)
    .flatMap(([indicatorId, after]) => {
      const before = initialReport.values[indicatorId];
      if (
        typeof before !== "number" ||
        !Number.isFinite(before) ||
        !Number.isFinite(after)
      )
        return [];
      const delta = after - before;
      return Number.isFinite(delta)
        ? [{ indicatorId, before, after, delta }]
        : [];
    })
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))[0];
  if (!change) return { ...selected, missing: "comparable-values" };

  const latestFirst = reports
    .filter((report) => report.monthIndex <= state.monthIndex)
    .sort((left, right) => right.monthIndex - left.monthIndex);
  const evidence = latestFirst.find(
    (report) =>
      report.monthIndex > 0 &&
      report.causalTrace?.completeness !== "initial" &&
      selectReportCauses(state, {
        monthIndex: report.monthIndex,
        indicatorId: change.indicatorId,
      }).causes.some((cause) => Number.isFinite(cause.delta)),
  );
  const valueReport = latestFirst.find((report) =>
    Number.isFinite(report.values[change.indicatorId]),
  )!;
  return {
    ...selected,
    largestChange: {
      ...change,
      target: {
        monthIndex: (evidence ?? valueReport).monthIndex,
        indicatorId: change.indicatorId,
        row: 0,
      },
      ...(!evidence ? { evidenceMissing: "cause" as const } : {}),
    },
  };
}
