import type { IndicatorId } from "./state";

export type CausalSourceType =
  "policy" | "event" | "external" | "inertia" | "random";
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
  | "governmentDebt"
  | "policyTrust"
  | "politicalCapital"
  | `industry.${string}.production`;
export type CausalConfidence = "high" | "medium" | "low";

export interface CausalRef {
  readonly sourceType: CausalSourceType;
  readonly sourceId: string;
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
