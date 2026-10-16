import type { IndicatorId, MonthlyReportCausalTrace } from "./state";

export type CausalSourceType =
  "policy" | "combo" | "event" | "external" | "inertia" | "random";
export type CausalMetricId =
  | IndicatorId
  | "consumption"
  | "investment"
  | "publicInvestment"
  | "governmentConsumption"
  | "outputGap"
  | "exports"
  | "imports"
  | "cpi"
  | "importPrice"
  | "nominalWage"
  | "expectedInflation"
  | "marketRate"
  | "consumerConfidence"
  | "businessConfidence"
  | "taxRevenue"
  | "primarySpending"
  | "interestPayment"
  | "primaryBalance"
  | "debtValuationAdjustment"
  | "governmentDebt"
  | "publicCapital"
  | "foreignReserves"
  | "implementationCapacity"
  | "industryAggregateResidual"
  | "policyTrust"
  | "politicalCapital"
  | `industry.${string}.production`
  | `industry.${string}.capacity`
  | `industry.${string}.employment`
  | `industry.${string}.importDependency`;
export type CausalConfidence = "high" | "medium" | "low";

export interface CausalRef {
  readonly sourceType: CausalSourceType;
  readonly sourceId: string;
  /** ScheduledEffect ID when this term comes from the effect queue. */
  readonly effectId?: string;
  readonly labelKey: string;
  readonly confidence: CausalConfidence;
}

export interface CausalTerm extends CausalRef {
  readonly delta: number;
}

export type CausalDiagnostic =
  | {
      readonly kind: "clamp";
      readonly rawValue: number;
      readonly adjustedValue: number;
      readonly delta: number;
      readonly min?: number;
      readonly max?: number;
    }
  | {
      readonly kind: "rounding";
      readonly internalValue: number;
      readonly displayValue: number;
      readonly displayDelta: number;
    }
  | {
      readonly kind: "residual";
      readonly expectedDelta: number;
      readonly contributionDelta: number;
      readonly residual: number;
    };

export interface CausalContribution {
  readonly indicatorId: CausalMetricId;
  readonly beforeValue: number;
  readonly afterValue: number;
  readonly totalDelta: number;
  readonly contributions: readonly CausalTerm[];
  readonly diagnostics: readonly CausalDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every((field) =>
    typeof value[field] === "number" && Number.isFinite(value[field]),
  );
}

function isCausalDiagnostic(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "clamp":
      return finiteFields(value, ["rawValue", "adjustedValue", "delta"]) &&
        ["min", "max"].every((field) =>
          value[field] === undefined || finiteFields(value, [field]),
        );
    case "rounding":
      return finiteFields(value, ["internalValue", "displayValue", "displayDelta"]);
    case "residual":
      return finiteFields(value, ["expectedDelta", "contributionDelta", "residual"]);
    default:
      return false;
  }
}

function isCausalContribution(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.indicatorId === "string" && value.indicatorId.length > 0 &&
    finiteFields(value, ["beforeValue", "afterValue", "totalDelta"]) &&
    Array.isArray(value.contributions) && value.contributions.every((term: unknown) =>
      isRecord(term) &&
      typeof term.sourceType === "string" &&
      ["policy", "combo", "event", "external", "inertia", "random"].includes(term.sourceType) &&
      typeof term.sourceId === "string" && term.sourceId.length > 0 &&
      typeof term.labelKey === "string" && term.labelKey.length > 0 &&
      (term.effectId === undefined || typeof term.effectId === "string") &&
      typeof term.confidence === "string" &&
      ["high", "medium", "low"].includes(term.confidence) &&
      finiteFields(term, ["delta"]),
    ) &&
    Array.isArray(value.diagnostics) && value.diagnostics.every(isCausalDiagnostic);
}

/** Validate persisted explanation data without rerunning economic calculations. */
export function isMonthlyReportCausalTrace(
  value: unknown,
): value is MonthlyReportCausalTrace {
  if (!isRecord(value) || !Array.isArray(value.indicators)) return false;
  if (value.completeness === "complete")
    return value.indicators.every(isCausalContribution);
  return (value.completeness === "initial" || value.completeness === "legacy-incomplete") &&
    value.indicators.length === 0;
}
