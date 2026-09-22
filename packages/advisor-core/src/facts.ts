import type { CausalContribution, GameState } from "@macro-nation/domain";
import type { HistoryRequest, NationFacts } from "./contracts";

/** Engine-to-AI adapter: a small allowlist, not a complete save or seed. */
export function projectFacts(
  state: GameState,
  causal: readonly CausalContribution[] = [],
  recentEvents: readonly string[] = [],
  policy?: string,
): NationFacts {
  const e = state.economy;
  return {
    month: state.monthIndex,
    indicators: {
      realGdp: e.indices.realGdp,
      gdpGrowth: e.metrics.realGdpGrowthAnnualized,
      inflation: e.rates.inflationAnnual,
      unemployment: e.rates.unemployment,
      policyRate: e.rates.policyRate,
      fx: e.indices.fx,
      fxChange: e.metrics.fxGrowthMonthly,
      governmentDebtRatio: e.ratios.governmentDebtRatio,
      support: e.sentiment.support,
    },
    causes: causal.slice(0, 12).flatMap((entry) =>
      entry.contributions.slice(0, 3).map((term) => ({
        indicator: entry.indicatorId,
        delta: entry.totalDelta,
        source: `${term.sourceType}:${term.sourceId}`,
        contribution: term.delta,
      })),
    ).slice(0, 18),
    recentEvents: recentEvents.slice(-3).map((event) => event.slice(0, 100)),
    ...(policy ? { policy: policy.slice(0, 160) } : {}),
  };
}

/** Deterministic summary selection before the optional API call. */
export function summarizeHistory(
  ending: NationFacts,
  entries: readonly { readonly month: number; readonly summary: string; readonly importance: number }[],
): HistoryRequest {
  return {
    ending,
    milestones: [...entries]
      .sort((a, b) => b.importance - a.importance || a.month - b.month)
      .slice(0, 18)
      .sort((a, b) => a.month - b.month)
      .map(({ month, summary }) => ({ month, summary: summary.slice(0, 120) })),
  };
}
