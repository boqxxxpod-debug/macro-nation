import { describe, expect, it } from "vitest";
import type { CausalContribution, GameState } from "@macro-nation/domain";
import { projectFacts } from "./facts";
import { ordinaryNews } from "./news";

const state = {
  monthIndex: 12,
  economy: {
    indices: { realGdp: 100.1, fx: 112 },
    rates: { inflationAnnual: 0.048, unemployment: 0.031, policyRate: 0.04 },
    ratios: { governmentDebtRatio: 0.6 },
    sentiment: { support: 55 },
  },
} as unknown as GameState;

function change(
  indicatorId: "realGdp" | "fx",
  beforeValue: number,
  afterValue: number,
): CausalContribution {
  return {
    indicatorId,
    beforeValue,
    afterValue,
    totalDelta: afterValue - beforeValue,
    contributions: [],
    diagnostics: [],
  };
}

describe("projectFacts", () => {
  it("projects annualized GDP growth and monthly FX change for news", () => {
    const facts = projectFacts(state, [
      change("realGdp", 100, 100.1),
      change("fx", 100, 112),
    ]);

    expect(facts.indicators.gdpGrowth).toBeCloseTo(0.01207, 4);
    expect(facts.indicators.fxChange).toBeCloseTo(0.12, 4);
    expect(ordinaryNews(facts).explanation).toContain("景気は拡大していますが");
    expect(ordinaryNews(facts).explanation).toContain("通貨安も家計の負担");
  });

  it("omits growth metrics when the previous level is not positive", () => {
    const facts = projectFacts(state, [
      change("realGdp", 0, 100),
      change("fx", -1, 112),
    ]);

    expect(facts.indicators.gdpGrowth).toBeUndefined();
    expect(facts.indicators.fxChange).toBeUndefined();
  });

  it("retains the reported value and its annual unit without adding optimistic claims", () => {
    const facts = projectFacts(state);
    const before = structuredClone(facts);
    const news = ordinaryNews(facts);
    expect(news.explanation).toContain("物価上昇率（年率）は4.8%です。");
    expect(news.explanation).not.toContain("景気は拡大");
    expect(facts).toEqual(before);
    expect(ordinaryNews(facts, "1.1.0").headline).toBe(
      "物価の上昇が家計に影響",
    );
    expect(ordinaryNews(facts, "1.1.0").explanation).toBe(
      "物価上昇率は4.8%。家計負担と景気の両方を確認しましょう。",
    );
  });
});
