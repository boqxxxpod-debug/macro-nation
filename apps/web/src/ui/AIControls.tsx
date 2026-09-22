import { useEffect, useState } from "react";
import type {
  AIService,
  Advice,
  ExpertProfile,
  FreePolicyResult,
  NationFacts,
  NewsStory,
  NationHistory,
} from "@macro-nation/advisor-core";
import { ordinaryNews } from "@macro-nation/advisor-core";

/** Embed into UI04/UI08/UI11 when the corresponding game screens ship. */
export function AIControls({
  service,
  facts,
  experts,
  finished = false,
  milestones = [],
  onCandidate,
}: {
  service: AIService;
  facts: NationFacts;
  experts: readonly ExpertProfile[];
  finished?: boolean;
  milestones?: readonly { month: number; summary: string }[];
  onCandidate?: (candidate: FreePolicyResult) => void;
}) {
  const [advice, setAdvice] = useState<readonly Advice[]>([]);
  const [story, setStory] = useState<NewsStory>(() => ordinaryNews(facts));
  const [history, setHistory] = useState<NationHistory | null>(null);
  const [text, setText] = useState("");
  const [policy, setPolicy] = useState<FreePolicyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedExpertIds, setSelectedExpertIds] = useState<readonly string[]>(
    () => (experts[0] ? [experts[0].id] : []),
  );
  useEffect(() => {
    setStory(ordinaryNews(facts));
    setAdvice([]);
    setHistory(null);
  }, [facts]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="経済解説">
      <h2>経済ニュース</h2>
      <h3>{story.headline}</h3>
      <p>{story.explanation}</p>
      {story.perspectives.map((item, index) => (
        <p key={`${item.viewpoint}-${index}`}>
          {item.viewpoint}: {item.text}
        </p>
      ))}
      <button
        disabled={busy}
        onClick={() =>
          void run(async () =>
            setStory(await service.news({ id: `month-${facts.month}`, facts })),
          )
        }
      >
        なぜこうなった？
      </button>
      <h2>政策会議</h2>
      <fieldset>
        <legend>専門家を選択（最大3人）</legend>
        {experts.map((expert) => (
          <label key={expert.id}>
            <input
              type="checkbox"
              checked={selectedExpertIds.includes(expert.id)}
              disabled={
                busy ||
                (!selectedExpertIds.includes(expert.id) &&
                  selectedExpertIds.length >= 3)
              }
              onChange={() =>
                setSelectedExpertIds((ids) =>
                  ids.includes(expert.id)
                    ? ids.filter((id) => id !== expert.id)
                    : ids.length < 3
                      ? [...ids, expert.id]
                      : ids,
                )
              }
            />
            {expert.role}
          </label>
        ))}
      </fieldset>
      <button
        disabled={busy || selectedExpertIds.length === 0}
        onClick={() =>
          void run(async () =>
            setAdvice(
              await service.advisors({
                experts: experts.filter((expert) =>
                  selectedExpertIds.includes(expert.id),
                ),
                facts,
              }),
            ),
          )
        }
      >
        専門家の意見を聞く
      </button>
      {advice.map((item) => (
        <article key={item.expertId}>
          <h3>
            {experts.find((x) => x.id === item.expertId)?.role ?? item.expertId}
          </h3>
          <p>{item.conclusion}</p>
          <p>{item.reason}</p>
          <p>{item.caution}</p>
        </article>
      ))}
      <label>
        自由入力政策
        <input
          maxLength={300}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <button
        disabled={busy || !text.trim()}
        onClick={() =>
          void run(async () => {
            const result = await service.freePolicy({ text });
            setPolicy(result);
            onCandidate?.(result);
          })
        }
      >
        政策案に変換
      </button>
      {policy && (
        <p role="status">
          {policy.explanation}
          {policy.status === "supported"
            ? " 内容を確認し、政策エンジンでプレビューしてください。"
            : ""}
        </p>
      )}
      {finished && (
        <>
          <h2>国家史</h2>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () =>
                setHistory(
                  await service.history({ ending: facts, milestones }),
                ),
              )
            }
          >
            国家史を生成
          </button>
          {history && (
            <article>
              <h3>{history.title}</h3>
              <p>{history.narrative}</p>
            </article>
          )}
        </>
      )}
    </section>
  );
}
