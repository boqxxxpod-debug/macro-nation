import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";

export const HOME_INDICATORS = [
  "realHouseholdIncome",
  "realGdp",
  "inflation",
  "unemployment",
  "policyTrust",
] as const;

export type HomeIndicatorId = (typeof HOME_INDICATORS)[number];

export interface HomeIndicator {
  readonly id: HomeIndicatorId;
  readonly current: number;
  readonly previous: number | undefined;
  readonly direction: "up" | "down" | "steady";
  readonly assessment: "improved" | "worsened" | "neutral";
}

const currentValue = (state: GameState, id: HomeIndicatorId): number => {
  const economy = state.economy;
  if (id === "realHouseholdIncome") return economy.indices.realHouseholdIncome;
  if (id === "realGdp") return economy.indices.realGdp;
  if (id === "inflation") return economy.rates.inflationAnnual;
  if (id === "unemployment") return economy.rates.unemployment;
  return economy.sentiment.policyTrust;
};

function assessment(
  id: HomeIndicatorId,
  current: number,
  previous?: number,
): HomeIndicator["assessment"] {
  if (previous === undefined || current === previous) return "neutral";
  const rose = current > previous;
  // Lower unemployment is beneficial. Inflation is assessed against the
  // configured model's two-percent target rather than treating every rise as bad.
  if (id === "unemployment") return rose ? "worsened" : "improved";
  if (id === "inflation")
    return Math.abs(current - 0.02) < Math.abs(previous - 0.02)
      ? "improved"
      : "worsened";
  return rose ? "improved" : "worsened";
}

export function selectHomeIndicators(
  state: GameState,
): readonly HomeIndicator[] {
  const reports = state.history.reports ?? [];
  const latest = reports.at(-1);
  const prior = reports.at(-2);
  return HOME_INDICATORS.map((id) => {
    const current = latest?.values[id] ?? currentValue(state, id);
    const previous = prior?.values[id];
    return {
      id,
      current,
      previous,
      direction:
        previous === undefined || current === previous
          ? "steady"
          : current > previous
            ? "up"
            : "down",
      assessment: assessment(id, current, previous),
    };
  });
}

export function selectHomeMilestones(state: GameState) {
  return [
    ...state.policies.reserved.map((policy) => ({
      month: policy.activationMonth,
      text: `政策発動（${policy.policyId}）`,
    })),
    ...state.policies.active
      .filter((policy) => policy.endMonth !== undefined)
      .map((policy) => ({
        month: policy.endMonth! + 1,
        text: `政策終了（${policy.policyId}）`,
      })),
    // Policy months are zero-based tick indices; endMonth is a completed-month
    // count, so convert it before the shared display adds one.
    { month: (state.clock.endMonth ?? 48) - 1, text: "シナリオ終了" },
  ]
    .filter((item) => item.month >= state.monthIndex)
    .sort((a, b) => a.month - b.month)
    .slice(0, 3);
}

export function selectHomeRecommendations(state: GameState): readonly string[] {
  if (state.difficulty !== "intro") return [];
  const recommendations: string[] = [];
  if (state.runState === "crisisStopped")
    recommendations.push("緊急政策を比較し、危機への対応を確認する");
  if (state.policies.active.length + state.policies.reserved.length === 0)
    recommendations.push("政策会議で最初の政策案を試算する");
  if (state.economy.rates.inflationAnnual > 0.04)
    recommendations.push("物価を抑える政策の効果と副作用を比較する");
  if (state.economy.rates.unemployment > 0.08)
    recommendations.push("雇用と成長を支える政策案を比較する");
  recommendations.push("レポートで今月の最大変化要因を確認する");
  return [...new Set(recommendations)].slice(0, 3);
}

export function topCause(
  latest?: MonthlyReportSnapshot,
): MonthlyReportSnapshot["topCauses"][number] | undefined {
  return [...(latest?.topCauses ?? [])].sort(
    (left, right) => Math.abs(right.delta) - Math.abs(left.delta),
  )[0];
}

export function causeCategory(sourceType: string): string {
  if (sourceType === "policy") return "政策";
  if (sourceType === "external" || sourceType === "event") return "外部要因";
  if (sourceType === "random") return "ランダム要因";
  return "慣性";
}
