import type { GameState } from "@macro-nation/domain";
import { evaluateEnding } from "../application/game-service";
import { describeCause, display, label } from "./game-format";
import { PageDeck } from "./PageDeck";
import {
  HISTORY_CATEGORY_LABELS,
  endingHistorySummary,
  nationalHistory,
} from "../application/history";

const AXES = [
  ["living", "暮らし"],
  ["growth", "成長"],
  ["stability", "安定"],
  ["sustainability", "持続性"],
  ["trust", "信頼"],
] as const;

export function Ending({
  state,
  onReport,
}: {
  state: GameState;
  onReport(): void;
}) {
  const result = evaluateEnding(state);
  const summary = endingHistorySummary(state);
  const first = state.history.reports?.[0];
  const last = state.history.reports?.at(-1);
  const changes = Object.keys(last?.values ?? {})
    .map((id) => ({
      id,
      before: first?.values[id] ?? 0,
      after: last?.values[id] ?? 0,
    }))
    .sort(
      (a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before),
    );
  const cause = last?.topCauses[0];
  return (
    <PageDeck
      label="終了評価の詳細"
      actions={<button onClick={onReport}>レポートで理由を見る</button>}
    >
      <p
        className={state.runState === "failed" ? "crisis" : "notice"}
        role="status"
      >
        {state.runState === "failed"
          ? "国家運営が終了しました。危機の原因を振り返りましょう。"
          : `${state.clock.endMonth}か月の運営が完了しました。`}
      </p>
      <section className="panel ending-score">
        <h3>総合評価：{result.rank}</h3>
        <strong>{result.score.toFixed(1)}点</strong>
        <p>架空のゲーム内評価です。政策思想の優劣を示しません。</p>
        <dl>
          {AXES.map(([key, title]) => (
            <div key={key}>
              <dt>{title}</dt>
              <dd>{result.axes[key].toFixed(1)} / 100</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="panel">
        <h3>国家史の要約</h3>
        {summary.mainDecisionIds.length ? (
          <p>主要判断：{summary.mainDecisionIds.join("、")}</p>
        ) : (
          <p>主要判断：新たな政策を追加せず運営しました。</p>
        )}
        <p>
          最大の転機：
          {summary.turningPoint
            ? `${summary.turningPoint.month}月目の${summary.turningPoint.categories.map((category) => HISTORY_CATEGORY_LABELS[category]).join("・")}`
            : "記録された転機はありません"}
        </p>
        {summary.latestReview && (
          <p>
            直近5年レビュー：成長 {summary.latestReview.axes.growth.toFixed(1)}
            、暮らし {summary.latestReview.axes.living.toFixed(1)}。
            {summary.previousReview
              ? ` 前回比（成長）${(summary.latestReview.axes.growth - summary.previousReview.axes.growth).toFixed(1)}点。`
              : " 最初のレビューです。"}
          </p>
        )}
        {state.runState === "failed" && (
          <p>
            失敗原因の参照：{summary.failureCauseRefs.join("、") || "危機条件"}
            。直前の判断も下の年表に保持されています。
          </p>
        )}
        <ol className="history-timeline">
          {nationalHistory(state).map((entry) => (
            <li key={entry.entryId}>
              {entry.month}月目：
              {entry.categories
                .map((category) => HISTORY_CATEGORY_LABELS[category])
                .join("・")}
            </li>
          ))}
        </ol>
      </section>
      <section className="panel">
        <h3>最も大きな変化と原因</h3>
        {changes[0] && (
          <p>
            {label(changes[0].id)}：開始{" "}
            {display(changes[0].id, changes[0].before)} → 最終{" "}
            {display(changes[0].id, changes[0].after)}。
          </p>
        )}
        <p>
          {cause
            ? `最終月の最大寄与は${label(cause.indicatorId)}への${describeCause(cause, state)}（寄与 ${cause.delta.toFixed(2)}）です。`
            : "最終月に記録された大きな寄与はありません。"}
        </p>
      </section>
    </PageDeck>
  );
}
