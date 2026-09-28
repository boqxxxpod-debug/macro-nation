import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  expertPortraitManifest,
  expertProfilesForContentVersion,
  ordinaryNews,
  projectFacts,
  RuleBasedExpertAdvisor,
} from "@macro-nation/advisor-core";
import type { GameState, MonthlyReportSnapshot } from "@macro-nation/domain";
import {
  createReservedPolicy,
  policyMeetingStatus,
  policyRules,
  type PolicyDraft,
  type PreviewOutput,
} from "../application/policy-view";
import { createBrowserAIService } from "../infrastructure/ai";
import {
  causeCategory,
  selectHomeIndicators,
  selectHomeMilestones,
  selectHomeRecommendations,
  topCause,
} from "../application/home-view";
import { describeCause, display, label } from "./game-format";
import { NationVoice } from "./NationVoice";
import { schoolLenses, visibleCauseCount } from "../application/learning";

function ExpertPortrait({ expertId }: { expertId: string }) {
  const portrait = expertPortraitManifest.find(
    (item) => item.expertId === expertId,
  );
  if (!portrait) return null;
  return (
    <img
      className="expert-portrait"
      src={portrait.src}
      srcSet={`${portrait.src2x} 2x`}
      alt={portrait.altText}
      onError={(event) => {
        event.currentTarget.hidden = true;
      }}
    />
  );
}

export function Home({
  state,
  onOpenReport,
  onOpenPolicies,
}: {
  state: GameState;
  onOpenReport(): void;
  onOpenPolicies(): void;
}) {
  const reports = state.history.reports ?? [];
  const latest = reports.at(-1);
  const prior = reports.at(-2);
  const e = state.economy;
  const crisis =
    state.runState === "crisisStopped" ||
    e.rates.inflationAnnual >= 0.08 ||
    e.rates.unemployment >= 0.1;
  const cards = selectHomeIndicators(state);
  const ranked = cards
    .filter((item) => item.previous !== undefined)
    .sort(
      (a, b) =>
        Math.abs((b.current - b.previous!) / (Math.abs(b.previous!) || 1)) -
        Math.abs((a.current - a.previous!) / (Math.abs(a.previous!) || 1)),
    );
  const milestones = selectHomeMilestones(state);
  const recommendations = selectHomeRecommendations(state);
  const primaryCause = topCause(latest);
  return (
    <>
      {state.monthIndex < 12 && state.learningMode === "learning" && (
        <section className="panel tutorial" aria-label="4四半期チュートリアル">
          <h3>はじめの4四半期・第{Math.floor(state.monthIndex / 3) + 1}回</h3>
          <p>
            {
              [
                "まず政策会議で案を比較し、確定するか何もしないか選びましょう。",
                "数か月進め、前月比と3行報告を確認しましょう。",
                "別の政策を試算し、12か月の副作用と費用を比べましょう。",
                "レポートで最大の変化要因を確認し、次の判断に備えましょう。",
              ][Math.floor(state.monthIndex / 3)]
            }
          </p>
          <p>この案内は説明だけです。計算は通常の月次Engineで進みます。</p>
        </section>
      )}
      <p className={crisis ? "crisis" : "quiet"} role="status">
        {crisis
          ? "危機警告：物価または雇用が危険域です。"
          : "重大な危機警告はありません。"}
      </p>
      {(state.events.warnings ?? []).map((warning) => (
        <section className="panel" key={warning.eventId}>
          <h3>イベントの兆候（警戒度 {warning.severity}）</h3>
          <p>
            {warning.eventId}：準備度 {Math.round(warning.preparedness * 100)}%
          </p>
          <p>
            {warning.missingIndicatorIds.length > 0
              ? `不足：${warning.missingIndicatorIds.join("、")}`
              : "主要な備えは整っています。"}
          </p>
        </section>
      ))}
      {prior && (
        <section className="panel">
          <h3>今月の3行報告</h3>
          <ol className="brief">
            {ranked.slice(0, 2).map(({ id, current, previous }) => (
              <li key={id}>
                <button className="brief-link" onClick={onOpenReport}>
                  {label(id)}は前月から
                  {current > previous!
                    ? "上昇"
                    : current < previous!
                      ? "低下"
                      : "横ばい"}
                  、{display(id, current)}です。
                </button>
              </li>
            ))}
            <li>
              <button className="brief-link" onClick={onOpenReport}>
                次に注意：最大の寄与は
                {latest?.topCauses[0]
                  ? `${label(latest.topCauses[0].indicatorId)}には${describeCause(latest.topCauses[0], state)}`
                  : "大きな変化は確認されていません"}
                。根拠を見る
              </button>
            </li>
          </ol>
        </section>
      )}
      <section>
        <h3>主要5指標</h3>
        <div className="indicator-grid">
          {cards.map(({ id, current, previous, direction, assessment }) => (
            <article className={`indicator indicator-${assessment}`} key={id}>
              <h4>{label(id)}</h4>
              <strong>{display(id, current)}</strong>
              <small>
                {previous === undefined
                  ? "開始時点"
                  : `前月比 ${direction === "up" ? "↑ 上昇" : direction === "down" ? "↓ 低下" : "→ 安定"} ${display(id, Math.abs(current - previous))}・${assessment === "improved" ? "良化" : assessment === "worsened" ? "悪化" : "安定"}`}
              </small>
            </article>
          ))}
        </div>
      </section>
      <section className="panel" aria-labelledby="cause-heading">
        <h3 id="cause-heading">最大変化要因</h3>
        {primaryCause ? (
          <p>
            <strong>{causeCategory(primaryCause.sourceType)}</strong>：
            {label(primaryCause.indicatorId)}には
            {describeCause(primaryCause, state)}が最大の寄与をしました。
          </p>
        ) : (
          <p>
            月次計算後に、政策・外部要因・慣性・ランダム要因の区分付きで表示します。
          </p>
        )}
        <button onClick={onOpenReport}>因果ログで根拠を見る</button>
      </section>
      <NationVoice state={state} onOpenCause={onOpenReport} />
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
      {recommendations.length > 0 && (
        <section
          className="panel recommendations"
          aria-labelledby="recommendations-heading"
        >
          <h3 id="recommendations-heading">首席補佐官の提案</h3>
          <ol>
            {recommendations.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ol>
          <p className="quiet">
            提案は自動では確定されません。比較してから判断してください。
          </p>
          <button onClick={onOpenPolicies}>政策会議で比較する</button>
        </section>
      )}
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
      <p className="quiet">
        ゲームモデル上の試算であり、現実経済の予測ではありません。
      </p>
      <section className="panel">
        <h3>経済の推移</h3>
        {["realGdp", "inflation", "unemployment"].map((id) => (
          <Trend key={id} reports={state.history.reports ?? []} id={id} />
        ))}
      </section>
      <NationVoice state={state} />
      <section className="panel">
        <h3>なぜ起きた</h3>
        <p>
          基準時点：前月からの変化。寄与の絶対値が大きい順に
          {visibleCauseCount(state.learningMode ?? "standard")}件を表示します。
        </p>
        {latest?.topCauses.length ? (
          <ol>
            {latest.topCauses
              .slice(0, visibleCauseCount(state.learningMode ?? "standard"))
              .map((cause, index) => (
                <li key={index}>
                  {label(cause.indicatorId)}：{describeCause(cause, state)}
                  、寄与 {cause.delta > 0 ? "+" : ""}
                  {cause.delta.toFixed(2)}
                </li>
              ))}
          </ol>
        ) : (
          <p>まだ月次の因果記録はありません。</p>
        )}
      </section>
      {state.learningMode === "learning" && (
        <section className="panel" aria-labelledby="school-lenses-heading">
          <h3 id="school-lenses-heading">思想比較</h3>
          <p>
            同じゲーム内の結果を、異なる目的と前提から読む比較レンズです。正解・順位・勝敗を示すものではありません。
          </p>
          <div className="school-lens-grid">
            {schoolLenses.map((lens) => (
              <article key={lens.schoolId}>
                <h4>{lens.displayName}</h4>
                <p>
                  <strong>重視する目的：</strong>
                  {lens.goals.join("、")}
                </p>
                <p>
                  <strong>前提：</strong>
                  {lens.premises.join("、")}
                </p>
                <p>
                  <strong>政策への見方：</strong>
                  {lens.view}
                </p>
                <p>
                  <strong>想定する利点：</strong>
                  {lens.benefits.join("、")}
                </p>
                <p>
                  <strong>想定するリスク：</strong>
                  {lens.risks.join("、")}
                </p>
              </article>
            ))}
          </div>
          <p className="quiet">
            ゲームモデル上の説明であり、現実の思想・政策の優劣判定や現実経済の予測ではありません。
          </p>
        </section>
      )}
      {state.learningMode === "learning" && (
        <section className="panel" aria-labelledby="forecast-records-heading">
          <h3 id="forecast-records-heading">専門家の予測記録</h3>
          {(state.history.forecastRecords ?? []).length ? (
            <ol>
              {(state.history.forecastRecords ?? [])
                .slice()
                .reverse()
                .map((record) => (
                  <li key={record.recordId}>
                    <strong>{record.recordedMonth}月目の政策判断</strong>
                    （専門家：{record.expertIds.join("、")}、確信度：
                    {record.confidence}）
                    <ul>
                      {record.horizons.map((horizon) => (
                        <li key={horizon.months}>
                          {horizon.months === 12 ? "1年" : "5年"}：GDP差{" "}
                          {display("realGdp", horizon.indicators.realGdp ?? 0)}
                        </li>
                      ))}
                    </ul>
                    <small>主な不確実性：{record.uncertainty}</small>
                  </li>
                ))}
            </ol>
          ) : (
            <p>政策会議で試算を確定すると、1年・5年の見通しを保存します。</p>
          )}
          <p className="quiet">
            予測値は全専門家で共通です。専門家は説明の焦点だけを変え、経済結果には影響しません。
          </p>
        </section>
      )}
      {state.learningMode === "learning" && (
        <section className="panel" aria-labelledby="notebook-heading">
          <h3 id="notebook-heading">経済学ノート</h3>
          {(state.history.learningEntries ?? []).length ? (
            <ol>
              {(state.history.learningEntries ?? [])
                .slice(-8)
                .reverse()
                .map((entry) => (
                  <li key={entry.entryId}>
                    <strong>{entry.concept}</strong>（{entry.month}月目・
                    {entry.kind}）<br />
                    <small>根拠：{entry.evidence}</small>
                  </li>
                ))}
            </ol>
          ) : (
            <p>月を進めると、用語・理論・判断・結果検証を自動保存します。</p>
          )}
          <p className="quiet">
            ノートは説明用であり、政策効果や勝敗には影響しません。
          </p>
        </section>
      )}
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
  onPreview(draft: PolicyDraft, expertIds: readonly string[]): void;
  busy: boolean;
}) {
  const rules = policyRules(state.configSnapshot);
  const profiles = expertProfilesForContentVersion(
    state.versions.contentVersion,
  );
  const [ruleId, setRuleId] = useState(rules[0]?.policyId ?? "");
  const rule = rules.find((item) => item.policyId === ruleId);
  const [value, setValue] = useState(
    rule?.inputs?.[0]?.defaultValue ?? rule?.referenceValue ?? 0.03,
  );
  const [ahead, setAhead] = useState(0);
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [expertIds, setExpertIds] = useState<readonly string[]>(["macro"]);
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
      <fieldset className="expert-picker">
        <legend>解説を聞く専門家（1〜3人）</legend>
        {profiles.map((expert) => (
          <label
            key={expert.id}
            style={{ "--expert-color": expert.colorToken } as CSSProperties}
          >
            <input
              type="checkbox"
              checked={expertIds.includes(expert.id)}
              disabled={
                expertIds.includes(expert.id)
                  ? expertIds.length === 1
                  : expertIds.length === 3
              }
              onChange={() =>
                setExpertIds((current) =>
                  current.includes(expert.id)
                    ? current.filter((id) => id !== expert.id)
                    : [...current, expert.id],
                )
              }
            />
            <ExpertPortrait expertId={expert.id} />
            <span>
              <strong>{expert.displayName ?? expert.role}</strong>
              <span className="expert-role">
                {expert.role} · {expert.tone}
              </span>
              <span>{expert.values}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <button
        className="primary"
        disabled={busy || meeting.slotsRemaining === 0 || !!shortage}
        onClick={() =>
          onPreview(
            {
              status: "draft",
              policyId: draftId,
              ruleId,
              value,
              quartersAhead: ahead,
            },
            expertIds,
          )
        }
      >
        1年・5年を比較する
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
  counterfactuals,
  expertIds,
  contentVersion,
  busy,
  onConfirm,
}: {
  output: PreviewOutput | null;
  counterfactuals: readonly PreviewOutput[];
  expertIds: readonly string[];
  contentVersion: string;
  busy: boolean;
  onConfirm(): void;
}) {
  if (!output)
    return (
      <p className="panel">政策会議で案を作成し、プレビューしてください。</p>
    );
  const forecast = (months: 12 | 60, indicatorId: string) =>
    output.summaries.find(
      (item) =>
        item.horizonMonths === months && item.indicatorId === indicatorId,
    );
  const directionalRanges = output.indicators
    .filter((item) =>
      ["realGdp", "inflation", "unemployment"].includes(item.indicatorId),
    )
    .map(({ month12 }) =>
      month12.deltaLow > 0 && month12.deltaHigh > 0
        ? true
        : month12.deltaLow < 0 && month12.deltaHigh < 0,
    );
  const directionalCount = directionalRanges.filter(Boolean).length;
  const confidence =
    directionalCount === directionalRanges.length
      ? "高"
      : directionalCount > 0
        ? "中"
        : "低";
  const profiles = expertProfilesForContentVersion(contentVersion);
  const advisor = new RuleBasedExpertAdvisor();
  const adviceContext = {
    effects: Object.fromEntries(
      output.summaries
        .filter((item) => item.horizonMonths === 60)
        .map((item) => [item.indicatorId, item.endDelta]),
    ),
    uncertainty: output.uncertainty.note,
  };
  const dissentingExpert = profiles.find(
    (profile) => !expertIds.includes(profile.id),
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
      <section className="panel" aria-labelledby="forecast-heading">
        <h3 id="forecast-heading">1年・5年の見通し</h3>
        <p>
          確信度：{confidence}。主な不確実性：
          {output.uncertainty.majorDrivers.map(label).join("、")}。
        </p>
        <div className="forecast-grid">
          {["realGdp", "inflation", "unemployment"].map((indicatorId) => (
            <article key={indicatorId}>
              <h4>{label(indicatorId)}</h4>
              <p>
                1年後の無介入との差：
                {display(indicatorId, forecast(12, indicatorId)?.endDelta ?? 0)}
              </p>
              <p>
                5年後の無介入との差：
                {display(indicatorId, forecast(60, indicatorId)?.endDelta ?? 0)}
              </p>
            </article>
          ))}
        </div>
      </section>
      <section className="panel" aria-labelledby="counterfactual-heading">
        <h3 id="counterfactual-heading">反実仮想：別の判断なら</h3>
        <p>
          基準時点：ゲーム内{" "}
          {output.activationMonth === null
            ? "現在"
            : `${output.activationMonth + 1}月目`}
          。すべて同じsnapshot・固定ショックで比較しています。
        </p>
        <div
          className="counterfactual-table"
          role="table"
          aria-label="政策案と無介入の比較"
        >
          <div role="row" className="table-head">
            <span role="columnheader">判断</span>
            <span role="columnheader">3か月</span>
            <span role="columnheader">6か月</span>
            <span role="columnheader">1年</span>
            <span role="columnheader">5年</span>
          </div>
          {[output, ...counterfactuals].map((candidate) => {
            const row = candidate.indicators.find(
              (item) => item.indicatorId === "realGdp",
            )!;
            const fiveYear = candidate.summaries.find(
              (item) =>
                item.indicatorId === "realGdp" && item.horizonMonths === 60,
            );
            return (
              <div role="row" key={candidate.draftHash}>
                <span role="cell">
                  {candidate.previewedDraft
                    ? label(candidate.previewedDraft.ruleId)
                    : "何もしない"}
                </span>
                {[
                  row.month3.deltaBase,
                  row.month6.deltaBase,
                  row.month12.deltaBase,
                  fiveYear?.endDelta ?? 0,
                ].map((value, index) => (
                  <span role="cell" key={index}>
                    {value > 0 ? "+" : ""}
                    {display("realGdp", value)}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
        <small>表示値は成長の無介入との差です。</small>
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
      <section className="panel" aria-labelledby="interaction-heading">
        <h3 id="interaction-heading">政策コンボ</h3>
        {output.comboResults.map((combo) => {
          const reason = combo.reason
            ? {
                "missing-required-policy": "必要な政策が揃っていません",
                "forbidden-policy": "同時に使えない政策があります",
                "insufficient-overlap": `重複期間が${combo.overlapMonths}か月で条件を満たしません`,
                "insufficient-additional-cost":
                  "コンボの追加費用が不足しています（政策自体は確定できます）",
                "missing-required-combo": "前提となるコンボが発動していません",
                "already-fired-this-month": "今月すでに発動済みです",
              }[combo.reason]
            : "すべての条件を満たします";
          return (
            <article className="combo-result" key={combo.comboId}>
              <h4>
                {combo.kind === "synergy" ? "相乗" : "相殺"}：{combo.comboId}
              </h4>
              <p>
                条件：{combo.requiredPolicyIds.map(label).join(" ＋ ")}
                {combo.forbiddenPolicyIds.length
                  ? `（併用不可：${combo.forbiddenPolicyIds.map(label).join("、")}）`
                  : ""}
              </p>
              <p>
                判定：{combo.activated ? "発動見込み" : "未発動見込み"} —{" "}
                {reason}。
              </p>
              <p>
                追加費用：政治資本 {combo.additionalCosts.politicalCapital}
                、実施能力 {combo.additionalCosts.implementationCapacity}
                、外貨準備 {combo.additionalCosts.foreignReserves}、予算{" "}
                {combo.additionalCosts.immediateBudget}。
              </p>
            </article>
          );
        })}
        {output.comboResults.length === 0 && (
          <p>定義済みの政策コンボはありません。</p>
        )}
      </section>
      <section className="panel" aria-labelledby="advice-heading">
        <h3 id="advice-heading">選択した専門家の解説</h3>
        {expertIds.map((expertId) => {
          const expert = profiles.find((item) => item.id === expertId)!;
          const advice = advisor.advise(expert, adviceContext);
          return (
            <article
              className="expert-advice"
              key={expertId}
              style={{ "--expert-color": expert.colorToken } as CSSProperties}
            >
              <ExpertPortrait expertId={expert.id} />
              <h4>{expert.role}</h4>
              <p className="quiet">
                {expert.displayName ?? expert.role} · 口調：{expert.tone}
              </p>
              <p>
                <strong>結論：</strong>
                {advice.conclusion}
              </p>
              <p>
                <strong>やさしい理由：</strong>
                {advice.reason}
              </p>
              <p>
                <strong>注意点：</strong>
                {advice.caution}
              </p>
              <details>
                <summary>用語：無追加政策比</summary>
                新しい政策を加えず、現在の政策だけを続けた場合との差です。
              </details>
            </article>
          );
        })}
        {dissentingExpert &&
          (() => {
            const dissent = advisor.advise(dissentingExpert, adviceContext);
            return (
              <aside className="expert-dissent">
                <strong>
                  別の視点 —{" "}
                  {dissentingExpert.displayName ?? dissentingExpert.role}：
                </strong>{" "}
                {dissent.conclusion} {dissent.caution}
              </aside>
            );
          })()}
      </section>
      <button className="primary" disabled={busy} onClick={onConfirm}>
        政策を確定して保存
      </button>
    </>
  );
}
