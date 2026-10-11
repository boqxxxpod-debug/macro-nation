import type { NationFacts, NewsStory } from "./contracts";
import content from "./content-v1.2.0.json";
import { renderContent } from "./display-names";

/** Ordinary news remains available offline and does not call a provider. */
export function ordinaryNews(
  facts: NationFacts,
  contentVersion = "1.2.0",
): NewsStory {
  const inflation = facts.indicators.inflation ?? 0;
  const unemployment = facts.indicators.unemployment ?? 0;
  const growth = facts.indicators.gdpGrowth ?? 0;
  if (contentVersion !== "1.0.0" && contentVersion !== "1.1.0") {
    const news = content.news;
    const headline =
      inflation >= 0.04
        ? news.inflationHeadline
        : unemployment >= 0.07
          ? news.employmentHeadline
          : news.ordinaryHeadline;
    const explanation =
      inflation >= 0.04
        ? `${growth > 0 ? news.growthLead : ""}${renderContent(news.inflationFact, { rate: (inflation * 100).toFixed(1) })}${(facts.indicators.fxChange ?? 0) >= 0.08 ? news.currencyCaution : news.inflationCaution}`
        : unemployment >= 0.07
          ? renderContent(news.employmentFact, {
              rate: (unemployment * 100).toFixed(1),
            })
          : news.ordinaryExplanation;
    return {
      headline,
      explanation,
      perspectives: [{ viewpoint: "anchor", text: explanation }],
    };
  }
  const headline =
    inflation >= 0.04
      ? "物価の上昇が家計に影響"
      : unemployment >= 0.07
        ? "雇用情勢に注意"
        : "今月の経済概況";
  const explanation =
    inflation >= 0.04
      ? `${growth > 0 ? "景気は拡大していますが、" : ""}物価上昇率は${(inflation * 100).toFixed(1)}%。${(facts.indicators.fxChange ?? 0) >= 0.08 ? "通貨安も家計の負担につながります。" : "家計負担と景気の両方を確認しましょう。"}`
      : unemployment >= 0.07
        ? `失業率は${(unemployment * 100).toFixed(1)}%。雇用の変化に注意が必要です。`
        : "主要指標とその変化を確認し、次の政策を検討しましょう。";
  return {
    headline,
    explanation,
    perspectives: [{ viewpoint: "anchor", text: explanation }],
  };
}

/** Only decides whether to show a button; never makes an automatic API call. */
export function isMajorNews(facts: NationFacts): boolean {
  return (
    (facts.indicators.inflation ?? 0) >= 0.08 ||
    (facts.indicators.unemployment ?? 0) >= 0.1 ||
    Math.abs(facts.indicators.fxChange ?? 0) >= 0.1 ||
    (facts.indicators.gdpGrowth ?? 0) <= -0.05 ||
    facts.causes.some((cause) => Math.abs(cause.delta) >= 5) ||
    facts.recentEvents.length > 0
  );
}
