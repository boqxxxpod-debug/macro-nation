import { useState } from "react";
import {
  AIService,
  MockAIProvider,
  expertProfiles,
} from "@macro-nation/advisor-core";
import { AIControls } from "../ui/AIControls";

const sampleFacts = {
  month: 12,
  indicators: {
    realGdp: 101.2,
    gdpGrowth: 0.012,
    inflation: 0.048,
    unemployment: 0.031,
    fxChange: 0.12,
  },
  causes: [
    {
      indicator: "inflation",
      delta: 0.015,
      source: "external:importPrices",
      contribution: 0.006,
    },
  ],
  recentEvents: ["輸入価格上昇"],
};

/** Development only: sample data; never a substitute for UI04/UI08/UI11 integration. */
export function AIPreview({
  onBack,
  onClose,
}: {
  onBack: () => void;
  onClose: () => void;
}) {
  const [service] = useState(
    () =>
      new AIService(new MockAIProvider(), {
        enabled: true,
        advisors: true,
        freePolicy: true,
        news: true,
        history: true,
      }),
  );
  return (
    <>
      <h2 tabIndex={-1}>開発用AIプレビュー</h2>
      <AIControls
        service={service}
        facts={sampleFacts}
        experts={expertProfiles}
        finished
        milestones={[{ month: 12, summary: "輸入価格が上昇" }]}
        pagination={{
          label: "開発用AIプレビュー",
          introduction: (
            <p>
              開発用Mockプレビュー（架空のサンプルデータ・API料金なし）。画面メニューから開いています。
            </p>
          ),
          actions: (
            <>
              <button onClick={onBack}>画面メニューに戻る</button>
              <button onClick={onClose}>閉じる</button>
            </>
          ),
        }}
      />
    </>
  );
}
