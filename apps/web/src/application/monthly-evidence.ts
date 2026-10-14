import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";
import { selectHomeIndicators, type HomeIndicator } from "./home-view";

export type ReportCause = MonthlyReportSnapshot["topCauses"][number];

export interface MonthlyEvidenceTarget {
  readonly monthIndex: number;
  readonly indicatorId?: string;
  readonly row: 0 | 1 | 2;
  readonly cause?: ReportCause;
}

export interface MonthlyEvidence {
  readonly report?: MonthlyReportSnapshot;
  readonly causes: readonly ReportCause[];
  readonly missing?: "report" | "indicator" | "cause";
}

/** Resolve the saved month and reason without substituting newer evidence. */
export function selectMonthlyEvidence(
  state: GameState,
  target: MonthlyEvidenceTarget,
): MonthlyEvidence {
  const report = state.history.reports?.find(
    (item) => item.monthIndex === target.monthIndex,
  );
  if (!report) return { causes: [], missing: "report" };

  if (target.row === 2) {
    const reference = target.cause;
    const cause = reference
      ? report.topCauses.find(
          (item) =>
            item.indicatorId === reference.indicatorId &&
            item.sourceType === reference.sourceType &&
            item.sourceId === reference.sourceId &&
            item.labelKey === reference.labelKey &&
            item.delta === reference.delta,
        )
      : undefined;
    return cause
      ? { report, causes: [cause] }
      : { report, causes: [], missing: "cause" };
  }

  if (!target.indicatorId) return { report, causes: [], missing: "indicator" };
  const causes = report.topCauses
    .filter((cause) => cause.indicatorId === target.indicatorId)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));
  return causes.length
    ? { report, causes }
    : { report, causes, missing: "cause" };
}

export interface MonthlyBrief {
  readonly report?: MonthlyReportSnapshot;
  readonly prior?: MonthlyReportSnapshot;
  readonly indicators: readonly HomeIndicator[];
  readonly cause?: ReportCause;
}

/** Keep the existing brief's order, using only snapshots through its own month. */
export function selectMonthlyBrief(
  state: GameState,
  monthIndex?: number,
): MonthlyBrief {
  const reports = state.history.reports ?? [];
  const index =
    monthIndex === undefined
      ? reports.length - 1
      : reports.findIndex((report) => report.monthIndex === monthIndex);
  const report = reports[index];
  if (!report) return { indicators: [] };
  const prior = reports[index - 1];
  const indicators = selectHomeIndicators({
    ...state,
    history: { ...state.history, reports: reports.slice(0, index + 1) },
  })
    .filter(
      (item) =>
        report.values[item.id] !== undefined && item.previous !== undefined,
    )
    .sort(
      (left, right) =>
        Math.abs(
          (right.current - right.previous!) / (Math.abs(right.previous!) || 1),
        ) -
        Math.abs(
          (left.current - left.previous!) / (Math.abs(left.previous!) || 1),
        ),
    )
    .slice(0, 2);
  const cause = report.topCauses[0];
  return {
    report,
    ...(prior ? { prior } : {}),
    indicators,
    ...(cause ? { cause } : {}),
  };
}

export function monthlyBriefButtonId(
  row: MonthlyEvidenceTarget["row"],
): string {
  return `monthly-brief-evidence-${row}`;
}

export function monthlyEvidenceQuery(target: MonthlyEvidenceTarget): string {
  const query = new URLSearchParams({
    month: String(target.monthIndex),
    row: String(target.row),
  });
  const indicatorId = target.cause?.indicatorId ?? target.indicatorId;
  if (indicatorId !== undefined) query.set("indicator", indicatorId);
  if (target.cause) {
    query.set("sourceType", target.cause.sourceType);
    query.set("sourceId", target.cause.sourceId);
    query.set("labelKey", target.cause.labelKey);
    query.set("delta", String(target.cause.delta));
  }
  return query.toString();
}

export function parseMonthlyEvidence(
  query: string,
): MonthlyEvidenceTarget | undefined {
  const params = new URLSearchParams(query);
  const keys = [
    "month",
    "row",
    "indicator",
    "sourceType",
    "sourceId",
    "labelKey",
    "delta",
  ];
  if (keys.some((key) => params.getAll(key).length > 1)) return undefined;
  const month = params.get("month");
  if (month === null || !/^\d+$/.test(month)) return undefined;
  const monthIndex = Number(month);
  if (!Number.isSafeInteger(monthIndex)) return undefined;
  const rawRow = params.get("row");
  if (rawRow !== "0" && rawRow !== "1" && rawRow !== "2") return undefined;
  const row = Number(rawRow) as MonthlyEvidenceTarget["row"];
  const indicatorId = params.get("indicator");
  if (indicatorId !== null && indicatorId.length === 0) return undefined;

  const hasCause = ["sourceType", "sourceId", "labelKey", "delta"].some((key) =>
    params.has(key),
  );
  if (!hasCause)
    return {
      monthIndex,
      row,
      ...(indicatorId !== null ? { indicatorId } : {}),
    };

  const sourceType = params.get("sourceType");
  const sourceId = params.get("sourceId");
  const labelKey = params.get("labelKey");
  const rawDelta = params.get("delta");
  if (
    !indicatorId ||
    !sourceType ||
    !sourceId ||
    !labelKey ||
    rawDelta === null ||
    !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(rawDelta)
  )
    return undefined;
  const delta = Number(rawDelta);
  if (!Number.isFinite(delta)) return undefined;
  return {
    monthIndex,
    row,
    indicatorId,
    cause: { indicatorId, sourceType, sourceId, labelKey, delta },
  };
}
