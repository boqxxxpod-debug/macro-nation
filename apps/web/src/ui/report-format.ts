import {
  CORE_INDICATOR_DEFINITIONS,
  type ConfigSnapshot,
  type IndicatorDefinition,
  type NumericUnit,
} from "@macro-nation/domain";

/** Units belong to the saved configuration, including extension indicators. */
export function reportIndicatorUnit(
  config: ConfigSnapshot,
  indicatorId: string,
): NumericUnit {
  const content = config.normalizedConfig.content as
    { indicatorDefinitions?: readonly IndicatorDefinition[] } | undefined;
  const defined =
    content?.indicatorDefinitions?.find(
      (item) => item.indicatorId === indicatorId,
    ) ??
    CORE_INDICATOR_DEFINITIONS.find((item) => item.indicatorId === indicatorId);
  if (defined) return defined.unit;
  if (["expectedInflation", "marketRate", "outputGap"].includes(indicatorId))
    return "PercentRate";
  if (/\.(importDependency|employment)$/.test(indicatorId)) return "Share01";
  if (
    [
      "consumerConfidence",
      "businessConfidence",
      "politicalCapital",
      "implementationCapacity",
    ].includes(indicatorId)
  )
    return "ScorePoint";
  if (
    ["publicCapital", "governmentDebt", "foreignReserves"].includes(indicatorId)
  )
    return "StockLevel";
  if (
    [
      "consumption",
      "investment",
      "publicInvestment",
      "governmentConsumption",
      "exports",
      "imports",
      "taxRevenue",
      "primarySpending",
      "interestPayment",
      "primaryBalance",
      "debtValuationAdjustment",
    ].includes(indicatorId)
  )
    return "FlowPerMonth";
  if (
    [
      "cpi",
      "importPrice",
      "nominalWage",
      "realHouseholdIncome",
      "potentialGdp",
      "manufacturing",
      "agriculture",
      "transport",
      "energy",
      "industryAggregateResidual",
    ].includes(indicatorId) ||
    /\.(production|capacity)$/.test(indicatorId)
  )
    return "IndexLevel";
  return "Scalar";
}

function preciseNumber(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.000001) return value.toExponential(4);
  return String(Number(value.toFixed(6)));
}

/** Preserve small monthly effects; rate changes use percentage points. */
export function reportNumber(
  value: number,
  unit: NumericUnit,
  change = false,
): string {
  const scaled = ["PercentRate", "Share01"].includes(unit)
    ? value * 100
    : value;
  const suffix =
    unit === "PercentRate" || unit === "Share01"
      ? change
        ? "パーセントポイント"
        : "%"
      : unit === "PercentPoint"
        ? "パーセントポイント"
        : unit === "IndexLevel"
          ? "指数"
          : unit === "ScorePoint"
            ? "点"
            : unit === "FlowPerMonth"
              ? "モデル単位/月"
              : unit === "StockLevel"
                ? "モデル単位"
                : unit === "MonthCount"
                  ? "か月"
                  : unit === "LogIndex"
                    ? "対数指数"
                    : "単位";
  return `${change && value > 0 ? "+" : ""}${preciseNumber(scaled)}${suffix}`;
}
