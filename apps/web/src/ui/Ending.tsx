import type { GameState } from "@macro-nation/domain";
import { evaluateEnding } from "../application/game-service";
import { selectEndingEvidence } from "../application/ending-evidence";
import type { MonthlyEvidenceTarget } from "../application/monthly-evidence";
import { describeCause, display, label } from "./game-format";
import { reportIndicatorUnit, reportNumber } from "./report-format";
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
  onReport(target?: MonthlyEvidenceTarget): void;
}) {
  const result = evaluateEnding(state);
  const summary = endingHistorySummary(state);
  const evidence = selectEndingEvidence(state);
  const change = evidence.largestChange;
  const monthly = evidence.finalMonth;
  const cause = monthly.cause;
  const endMonth = evidence.period.endMonthIndex;
  return (
    <PageDeck
      label="終了評価の詳細"
      actions={<button onClick={() => onReport()}>変化の理由を見る</button>}
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
      <section
        className="panel"
        aria-label="期間全体の主な変化"
        data-ending-period-start={0}
        data-ending-period-end={endMonth}
        data-ending-indicator={change?.indicatorId}
      >
        <h3>期間全体の主な変化</h3>
        <p>
          対象期間：{endMonth}か月全体（開始時点 → {endMonth}月目）。
        </p>
        {change ? (
          <>
            <p>
              {label(change.indicatorId)}：開始{" "}
              {display(change.indicatorId, change.before)} → 最終{" "}
              {display(change.indicatorId, change.after)}。
            </p>
            <p>
              期間全体の理由を示す因果記録はありません。月次の要因を期間全体の理由として結び付けません。
            </p>
            {change.evidenceMissing && (
              <p>
                {label(change.indicatorId)}
                について表示できる月次の理由がありません。記録の欠如は、影響がなかったことを意味しません。
              </p>
            )}
            <p>
              {change.target.monthIndex}月目の{label(change.indicatorId)}
              の保存記録を確認できます。対象はその月だけで、期間全体とは異なります。
            </p>
            <button onClick={() => onReport(change.target)}>
              {label(change.indicatorId)}の月次記録を見る（
              {change.target.monthIndex}月目）
            </button>
          </>
        ) : (
          <p>
            {evidence.missing === "initial-report"
              ? "開始時点の記録がないため、期間全体の変化を比較できません。"
              : evidence.missing === "final-report"
                ? "終了時点の記録がないため、期間全体の変化を比較できません。"
                : "開始時点と終了時点で比較できる指標の記録がありません。"}
            レポートで保存されている月の記録を確認してください。
          </p>
        )}
      </section>
      <section
        className="panel"
        aria-label="最終月に大きく影響したこと"
        data-ending-period-start={Math.max(0, endMonth - 1)}
        data-ending-period-end={endMonth}
        data-ending-indicator={
          cause?.indicatorId ?? monthly.target?.indicatorId
        }
      >
        <h3>最終月に大きく影響したこと</h3>
        <p>
          {endMonth > 0
            ? `対象期間：最終月（${endMonth - 1}月目 → ${endMonth}月目の1か月）。`
            : "月次の進行記録はありません。"}
        </p>
        <p>
          {cause
            ? `最終月の${label(cause.indicatorId)}には、${describeCause(cause, state)}が影響しました（この1か月の変化への影響 ${reportNumber(cause.delta, reportIndicatorUnit(state.configSnapshot, cause.indicatorId), true)}）。`
            : monthly.missing === "report"
              ? "最終月の記録が保存されていません。別の月の理由で置き換えることはできません。"
              : "表示できる月次の理由がありません。記録の欠如は、影響がなかったことを意味しません。"}
        </p>
        {monthly.completeness === "legacy-incomplete" && (
          <p>
            最終月は旧形式の記録です。保存された上位の寄与に限られ、全内訳は確認できません。
          </p>
        )}
        {monthly.target && (
          <button onClick={() => onReport(monthly.target)}>
            {cause
              ? "最終月の要因をレポートで見る"
              : "最終月の記録をレポートで見る"}
          </button>
        )}
      </section>
    </PageDeck>
  );
}
