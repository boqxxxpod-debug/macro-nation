import { useEffect, useMemo, useState } from "react";
import { ordinaryNews, projectFacts } from "@macro-nation/advisor-core";
import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";
import {
  createReservedPolicy,
  policyMeetingStatus,
  policyRules,
  type PolicyDraft,
  type PreviewOutput,
} from "../application/policy-view";
import { createBrowserAIService } from "../infrastructure/ai";
import { display, label } from "./game-format";

const CARD_KEYS = [
  "realHouseholdIncome",
  "realGdp",
  "inflation",
  "unemployment",
  "policyTrust",
] as const;

export function Home({ state }: { state: GameState }) {
  const reports = state.history.reports ?? [];
  const latest = reports.at(-1);
  const prior = reports.at(-2);
  const e = state.economy;
  const crisis = e.rates.inflationAnnual >= 0.08 || e.rates.unemployment >= 0.1;
  const cards = CARD_KEYS.map((id) => ({
    id,
    current:
      latest?.values[id] ??
      (id === "realHouseholdIncome"
        ? e.indices.realHouseholdIncome
        : id === "realGdp"
          ? e.indices.realGdp
          : id === "inflation"
            ? e.rates.inflationAnnual
            : id === "unemployment"
              ? e.rates.unemployment
              : e.sentiment.policyTrust),
    previous: prior?.values[id],
  }));
  const ranked = cards
    .filter((item) => item.previous !== undefined)
    .sort(
      (a, b) =>
        Math.abs((b.current - b.previous!) / (Math.abs(b.previous!) || 1)) -
        Math.abs((a.current - a.previous!) / (Math.abs(a.previous!) || 1)),
    );
  const milestones = [
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
    { month: 48, text: "入門シナリオの節目" },
  ]
    .filter((item) => item.month >= state.monthIndex)
    .sort((a, b) => a.month - b.month)
    .slice(0, 3);
  return (
    <>
      <p className={crisis ? "crisis" : "quiet"} role="status">
        {crisis
          ? "危機警告：物価または雇用が危険域です。"
          : "重大な危機警告はありません。"}
      </p>
      {prior && (
        <section className="panel">
          <h3>今月の3行報告</h3>
          <ol className="brief">
            {ranked.slice(0, 2).map(({ id, current, previous }) => (
              <li key={id}>
                {label(id)}は前月から
                {current > previous!
                  ? "上昇"
                  : current < previous!
                    ? "低下"
                    : "横ばい"}
                、{display(id, current)}です。
              </li>
            ))}
            <li>
              最大の寄与：
              {latest?.topCauses[0]
                ? `${label(latest.topCauses[0].indicatorId)}の${latest.topCauses[0].sourceType === "policy" ? "政策" : "経済環境"}要因`
                : "大きな変化は確認されていません"}
              。
            </li>
          </ol>
        </section>
      )}
      <section>
        <h3>主要5指標</h3>
        <div className="indicator-grid">
          {cards.map(({ id, current, previous }) => (
            <article className="indicator" key={id}>
              <h4>{label(id)}</h4>
              <strong>{display(id, current)}</strong>
              <small>
                {previous === undefined
                  ? "開始時点"
                  : `前月比 ${current > previous ? "↑ 上昇" : current < previous ? "↓ 低下" : "→ 横ばい"} ${display(id, Math.abs(current - previous))}`}
              </small>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <h3>次の節目</h3>
        <ul>
          {milestones.map((item, index) => (
            <li key={index}>
              {item.month + 1}月目：{item.text}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Trend({
  reports,
  id,
}: {
  reports: readonly MonthlyReportSnapshot[];
  id: string;
}) {
  const values = reports
    .map((report) => report.values[id])
    .filter((value): value is number => value !== undefined);
  if (values.length < 2) return <p>推移は2か月目から表示します。</p>;
  const min = Math.min(...values),
    span = Math.max(...values) - min || 1;
  const points = values
    .map(
      (value, index) =>
        `${(index / (values.length - 1)) * 100},${44 - ((value - min) / span) * 38}`,
    )
    .join(" ");
  return (
    <figure className="trend">
      <svg
        role="img"
        aria-label={`${label(id)}の${values.length}か月の推移`}
        viewBox="0 0 100 50"
        preserveAspectRatio="none"
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption>
        {label(id)}：開始 {display(id, values[0]!)} → 現在{" "}
        {display(id, values.at(-1)!)}
      </figcaption>
    </figure>
  );
}

export function Report({ state }: { state: GameState }) {
  const latest = state.history.reports?.at(-1);
  const [story, setStory] = useState(() => ordinaryNews(projectFacts(state)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const service = useMemo(() => createBrowserAIService(), []);
  useEffect(() => {
    setStory(ordinaryNews(projectFacts(state)));
  }, [state]);
  const facts = {
    ...projectFacts(state),
    causes: (latest?.topCauses ?? []).map((cause) => ({
      indicator: cause.indicatorId,
      delta: cause.delta,
      source: `${cause.sourceType}:${cause.sourceId}`,
      contribution: cause.delta,
    })),
  };
  return (
    <>
      <section className="panel">
        <h3>経済の推移</h3>
        {["realGdp", "inflation", "unemployment"].map((id) => (
          <Trend key={id} reports={state.history.reports ?? []} id={id} />
        ))}
      </section>
      <section className="panel">
        <h3>今月の主な原因</h3>
        {latest?.topCauses.length ? (
          <ol>
            {latest.topCauses.slice(0, 3).map((cause, index) => (
              <li key={index}>
                {label(cause.indicatorId)}：
                {cause.sourceType === "policy"
                  ? "政策"
                  : cause.sourceType === "external"
                    ? "外部環境"
                    : cause.sourceType === "random"
                      ? "変動"
                      : "経済の慣性"}
                （{cause.sourceId}）、寄与 {cause.delta > 0 ? "+" : ""}
                {cause.delta.toFixed(2)}
              </li>
            ))}
          </ol>
        ) : (
          <p>まだ月次の因果記録はありません。</p>
        )}
      </section>
      <section className="panel">
        <h3>経済ニュース</h3>
        <h4>{story.headline}</h4>
        <p>{story.explanation}</p>
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void service
              .news({ id: `month-${facts.month}`, facts })
              .then(setStory)
              .catch((cause: unknown) =>
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "報道を生成できませんでした",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          特別報道を読む
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
    </>
  );
}

export function PolicyForm({
  state,
  onPreview,
  busy,
}: {
  state: GameState;
  onPreview(draft: PolicyDraft): void;
  busy: boolean;
}) {
  const rules = policyRules(state.configSnapshot);
  const [ruleId, setRuleId] = useState(rules[0]?.policyId ?? "");
  const rule = rules.find((item) => item.policyId === ruleId);
  const [value, setValue] = useState(
    rule?.inputs?.[0]?.defaultValue ?? rule?.referenceValue ?? 0.03,
  );
  const [ahead, setAhead] = useState(0);
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const meeting = policyMeetingStatus(state);
  const shortage = (() => {
    try {
      const costs = createReservedPolicy(
        state,
        ruleId,
        value,
        draftId,
        ahead,
      ).costs;
      const held = state.policyAdministration?.reservations ?? [];
      const resources = {
        politicalCapital: state.resources.politicalCapital,
        implementationCapacity: state.resources.implementationCapacity,
        foreignReserves: state.economy.stocks.foreignReserves,
        immediateBudget: state.resources.discretionaryBudget,
      };
      for (const key of Object.keys(costs) as (keyof typeof costs)[]) {
        const available =
          resources[key] - held.reduce((sum, item) => sum + item.costs[key], 0);
        if (costs[key] > available)
          return `${key === "foreignReserves" ? "外貨準備" : key === "politicalCapital" ? "政治資本" : key === "implementationCapacity" ? "実施能力" : "開始予算"}が不足しています。必要 ${costs[key].toFixed(1)}、利用可能 ${available.toFixed(1)}。`;
      }
      return "";
    } catch {
      return "設定値が政策の許容範囲外です。";
    }
  })();
  return (
    <section className="panel">
      <h3>政策案を作る</h3>
      <label>
        政策の種類
        <select
          value={ruleId}
          onChange={(event) => {
            const next = rules.find(
              (item) => item.policyId === event.target.value,
            );
            setRuleId(event.target.value);
            setValue(
              next?.inputs?.[0]?.defaultValue ?? next?.referenceValue ?? 0.03,
            );
            setDraftId(crypto.randomUUID());
          }}
        >
          {rules.map((item) => (
            <option key={item.policyId} value={item.policyId}>
              {label(item.policyId)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {label(ruleId)}の設定値
        <input
          type="number"
          required
          min={rule?.inputs?.[0]?.min ?? rule?.inputMin}
          max={rule?.inputs?.[0]?.max ?? rule?.inputMax}
          step={rule?.inputs?.[0]?.step ?? "any"}
          value={value}
          onChange={(event) => setValue(Number(event.target.value))}
        />
      </label>
      <label>
        発動時期
        <select
          value={ahead}
          onChange={(event) => setAhead(Number(event.target.value))}
        >
          {[0, 1, 2, 3].map((offset) => (
            <option key={offset} value={offset}>
              {offset === 0 ? "即時" : `${offset}四半期後`}
            </option>
          ))}
        </select>
      </label>
      <div className="expert-slot" aria-label="専門家選択の追加予定領域">
        専門家の視点（今後追加）
      </div>
      <button
        className="primary"
        disabled={busy || meeting.slotsRemaining === 0 || !!shortage}
        onClick={() =>
          onPreview({
            status: "draft",
            policyId: draftId,
            ruleId,
            value,
            quartersAhead: ahead,
          })
        }
      >
        12か月を比較する
      </button>
      {meeting.slotsRemaining === 0 && (
        <p>今四半期の3枠を使い切りました。次の更新月までお待ちください。</p>
      )}
      {shortage && <p role="status">{shortage}</p>}
    </section>
  );
}

export function Preview({
  output,
  busy,
  onConfirm,
}: {
  output: PreviewOutput | null;
  busy: boolean;
  onConfirm(): void;
}) {
  if (!output)
    return (
      <p className="panel">政策会議で案を作成し、プレビューしてください。</p>
    );
  return (
    <>
      <p className="quiet">
        ゲーム内モデルの試算です。低・中・高は固定ショック分位に基づく幅です。
      </p>
      <section className="panel">
        <h3>無追加政策との12か月比較</h3>
        <div className="comparison-list">
          {output.indicators
            .filter((item) =>
              [
                "realGdp",
                "inflation",
                "unemployment",
                "policyTrust",
                "foreignReserves",
              ].includes(item.indicatorId),
            )
            .map((item) => (
              <article key={item.indicatorId}>
                <h4>{label(item.indicatorId)}</h4>
                <p>
                  3か月：{display(item.indicatorId, item.month3.low)} ～{" "}
                  {display(item.indicatorId, item.month3.high)}（中心{" "}
                  {display(item.indicatorId, item.month3.base)}）
                </p>
                <p>
                  6か月：{display(item.indicatorId, item.month6.low)} ～{" "}
                  {display(item.indicatorId, item.month6.high)}
                </p>
                <p>
                  12か月：{display(item.indicatorId, item.month12.low)} ～{" "}
                  {display(item.indicatorId, item.month12.high)}
                  、無追加政策との差 {item.month12.deltaBase > 0 ? "+" : ""}
                  {display(item.indicatorId, item.month12.deltaBase)}
                </p>
              </article>
            ))}
        </div>
      </section>
      <section className="panel">
        <h3>効果と費用</h3>
        <p>
          発動：
          {output.activationMonth === null
            ? "未設定"
            : `${output.activationMonth + 1}月目`}
          。最大効果：
          {output.summaries.find(
            (item) =>
              item.indicatorId === "realGdp" && item.horizonMonths === 12,
          )?.peakMonth ?? "—"}
          か月後。
        </p>
        <p>
          主効果 {output.primaryEffects.length}件、副作用{" "}
          {output.sideEffects.length}件。
        </p>
        <ul>
          {output.sideEffects.slice(0, 3).map((effect) => (
            <li key={effect.effectId}>
              {label(effect.targetPath)}：{effect.startMonth + 1}月目から
            </li>
          ))}
        </ul>
        <p>
          必要資源：政治資本 {output.costs.politicalCapital}、実施能力{" "}
          {output.costs.implementationCapacity}、外貨準備{" "}
          {output.costs.foreignReserves.toFixed(1)}、開始予算{" "}
          {output.costs.immediateBudget}。
        </p>
        {output.interactions.length > 0 && (
          <p>同種の政策と重なります：{output.interactions.join("、")}</p>
        )}
        <p>{output.uncertainty.note}</p>
      </section>
      <button className="primary" disabled={busy} onClick={onConfirm}>
        政策を確定して保存
      </button>
    </>
  );
}
