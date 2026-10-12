import type { GameState } from "@macro-nation/domain";
import { evaluateEnding } from "../application/game-service";
import { describeCause, display, label } from "./game-format";
import { PageDeck } from "./PageDeck";
import {
  HISTORY_CATEGORY_LABELS,
  endingHistorySummary,
  historyCauseDisplay,
  historyReferenceDisplay,
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
      actions={<button onClick={onReport}>変化の理由を見る</button>}
    >
      <p
        className={state.runState === "failed" ? "crisis" : "notice"}
        role="status"
      >
        {state.runState === "failed"
          ? "危機のため国家運営を終了しました。変化の理由と直前の判断を振り返りましょう。"
          : `${state.clock.endMonth}か月の運営期間を終えました。これまでの歩みを振り返りましょう。`}
      </p>
      <section className="panel ending-score">
        <h3>総合評価：{result.rank}</h3>
        <strong>{result.score.toFixed(1)}点</strong>
        <p>
          架空のゲーム内評価です。現実の政策や思想の優劣を示すものではありません。
        </p>
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
          <p>
            主な判断：
            {[
              ...new Set(
                summary.mainDecisionIds.map((id) =>
                  historyReferenceDisplay(id, state),
                ),
              ),
            ].join("、")}
          </p>
        ) : (
          <p>新しい政策を加えず、今の政策を続けました。</p>
        )}
        <p>
          いちばん大きな転機：
          {summary.turningPoint
            ? `${summary.turningPoint.month}月目の${summary.turningPoint.categories.map((category) => HISTORY_CATEGORY_LABELS[category]).join("・")}`
            : "転機はまだ記録されていません"}
        </p>
        {summary.latestReview && (
          <p>
            直近の5年の振り返り：成長{" "}
            {summary.latestReview.axes.growth.toFixed(1)}
            、暮らし {summary.latestReview.axes.living.toFixed(1)}。
            {summary.previousReview
              ? ` 前回比（成長）${(summary.latestReview.axes.growth - summary.previousReview.axes.growth).toFixed(1)}点。`
              : " はじめての振り返りです。"}
          </p>
        )}
        {state.runState === "failed" && (
          <p>
            危機につながったこと：
            {[
              ...new Set(
                summary.failureCauseRefs.map((ref) =>
                  historyCauseDisplay(ref, state),
                ),
              ),
            ].join("、") || "国の状態が危機の条件に達しました"}
            。直前の判断は下の年表で確認できます。
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
        <h3>いちばん大きな変化と理由</h3>
        {changes[0] && (
          <p>
            {label(changes[0].id)}：開始{" "}
            {display(changes[0].id, changes[0].before)} → 最終{" "}
            {display(changes[0].id, changes[0].after)}。
          </p>
        )}
        <p>
          {cause
            ? `最終月の${label(cause.indicatorId)}には、${describeCause(cause, state)}がいちばん大きく影響しました（変化への影響 ${cause.delta.toFixed(2)}）。`
            : "最終月には、大きな変化の理由が記録されていません。"}
        </p>
      </section>
    </PageDeck>
  );
}
