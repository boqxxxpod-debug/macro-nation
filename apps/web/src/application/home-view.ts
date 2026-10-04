import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";
import { policyTypeDisplayName } from "./history";

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
      text: `${policyTypeDisplayName(policy.type)}の政策が始まります`,
    })),
    ...state.policies.active
      .filter((policy) => policy.endMonth !== undefined)
      .map((policy) => ({
        month: policy.endMonth! + 1,
        text: `${policyTypeDisplayName(policy.type)}の政策が終わります`,
      })),
    // Policy months are zero-based tick indices; endMonth is a completed-month
    // count, so convert it before the shared display adds one.
    {
      month: (state.clock.endMonth ?? 48) - 1,
      text: "予定の運営期間が終わります",
    },
  ]
    .filter((item) => item.month >= state.monthIndex)
    .sort((a, b) => a.month - b.month)
    .slice(0, 3);
}

export function selectHomeRecommendations(state: GameState): readonly string[] {
  if (state.difficulty !== "intro") return [];
  const recommendations: string[] = [];
  if (state.runState === "crisisStopped")
    recommendations.push("緊急政策を比べて、危機への対応を確認しましょう。");
  if (state.policies.active.length + state.policies.reserved.length === 0)
    recommendations.push(
      "政策会議で、最初の政策案の見通しを確認してみましょう。",
    );
  if (state.economy.rates.inflationAnnual > 0.04)
    recommendations.push("物価を抑える政策の効果と副作用を比べてみましょう。");
  if (state.economy.rates.unemployment > 0.08)
    recommendations.push("雇用と成長を支える政策案を比べてみましょう。");
  recommendations.push("レポートで、今月の変化の理由を見てみましょう。");
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
  if (sourceType === "combo") return "政策の組み合わせ";
  if (sourceType === "external") return "外部環境";
  if (sourceType === "event") return "イベント";
  if (sourceType === "random") return "偶発的な変動";
  return "前月から続く動き";
}
