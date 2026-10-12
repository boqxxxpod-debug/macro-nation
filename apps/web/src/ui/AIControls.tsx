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

const VIEWPOINT_LABELS: Record<
  NewsStory["perspectives"][number]["viewpoint"],
  string
> = {
  anchor: "解説",
  newspaper: "新聞の視点",
  citizen: "国民の視点",
  business: "企業の視点",
  social: "暮らしの視点",
};

/** Embed into UI04/UI08/UI11 when the corresponding game screens ship. */
export function AIControls({
  service,
  facts,
  contentVersion,
  experts,
  finished = false,
  milestones = [],
  onCandidate,
}: {
  service: AIService;
  facts: NationFacts;
  contentVersion?: string;
  experts: readonly ExpertProfile[];
  finished?: boolean;
  milestones?: readonly { month: number; summary: string }[];
  onCandidate?: (candidate: FreePolicyResult) => void;
}) {
  const [advice, setAdvice] = useState<readonly Advice[]>([]);
  const [story, setStory] = useState<NewsStory>(() =>
    ordinaryNews(facts, contentVersion),
  );
  const [history, setHistory] = useState<NationHistory | null>(null);
  const [text, setText] = useState("");
  const [policy, setPolicy] = useState<FreePolicyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedExpertIds, setSelectedExpertIds] = useState<readonly string[]>(
    () => (experts[0] ? [experts[0].id] : []),
  );
  useEffect(() => {
    setStory(ordinaryNews(facts, contentVersion));
    setAdvice([]);
    setHistory(null);
  }, [facts, contentVersion]);
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
      <p>
        AIは任意の機能です。AI連携が有効な場合、ボタンを押すと、選んだ機能に必要な指標・変化の理由・直近の出来事・専門家・国家史の節目を外部のAI提供元へ送ります。自由入力の政策は、入力文も送ります。個人情報は入力しないでください。
      </p>
      <p>
        AIが使えないときも、ゲーム内の解説で遊び続けられます。AIの説明や政策の候補だけで、経済の計算結果は変わりません。
      </p>
      <h2>経済ニュース</h2>
      <h3>{story.headline}</h3>
      <p>{story.explanation}</p>
      {story.perspectives.map((item, index) => (
        <p key={`${item.viewpoint}-${index}`}>
          {VIEWPOINT_LABELS[item.viewpoint]}：{item.text}
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
        ニュースの理由を聞く
      </button>
      <h2>政策会議</h2>
      <fieldset>
        <legend>意見を聞きたい専門家を選ぶ（1〜3人）</legend>
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
            {expert.displayName
              ? `${expert.displayName}（${expert.role}）`
              : expert.role}
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
            {experts.find((x) => x.id === item.expertId)?.displayName ??
              experts.find((x) => x.id === item.expertId)?.role ??
              "専門家の意見"}
          </h3>
          <p>{item.conclusion}</p>
          <p>{item.reason}</p>
          <p>{item.caution}</p>
        </article>
      ))}
      <label>
        政策のアイデアを入力する
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
        政策案を作る
      </button>
      {policy && (
        <p role="status">
          {policy.explanation}
          {policy.status === "supported"
            ? " 内容を確認して、政策の見通しを確認しましょう。確定するまで政策は実行されません。"
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
            国の歩みを文章にする
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
