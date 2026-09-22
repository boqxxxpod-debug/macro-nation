import { AIService, MockAIProvider } from "@macro-nation/advisor-core";
import { AIControls } from "../ui/AIControls";

const service = new AIService(new MockAIProvider(), {
  enabled: true, advisors: true, freePolicy: true, news: true, history: true,
});
const sampleFacts = {
  month: 12,
  indicators: { realGdp: 101.2, gdpGrowth: 0.012, inflation: 0.048, unemployment: 0.031, fxChange: 0.12 },
  causes: [{ indicator: "inflation", delta: 0.015, source: "external:importPrices", contribution: 0.006 }],
  recentEvents: ["輸入価格上昇"],
};

/** Development only: sample data; never a substitute for UI04/UI08/UI11 integration. */
export function AIPreview() {
  return <section className="foundation-card" aria-label="開発用AIプレビュー">
    <p>開発用Mockプレビュー（架空のサンプルデータ・API料金なし）</p>
    <AIControls service={service} facts={sampleFacts} experts={[
      { id: "centralBank", role: "中央銀行", values: "物価安定", tone: "慎重" },
      { id: "labor", role: "雇用", values: "雇用の維持", tone: "親しみやすい" },
    ]} finished milestones={[{ month: 12, summary: "輸入価格が上昇" }]} />
  </section>;
}
