import type { GameState, PolicyDecision } from "@macro-nation/domain";
import { selectLatestConfirmedPolicy } from "../application/policy-confirmation";
import { isTutorialTime } from "../application/game-clock";
import { label } from "./game-format";
import policyInputCopy from "./policy-input-copy.json";

const STATUS_LABELS: Record<PolicyDecision["status"], string> = {
  draft: "未確定",
  previewed: "未確定",
  committed: "確定済み",
  reserved: "開始待ち（予約中）",
  active: "実施中",
  completed: "実施終了",
  cancelled: "取消済み",
  terminated: "途中終了",
};

function nextStep(state: GameState): string {
  if (state.runState === "awaitingEvent")
    return "まずホームでイベントへの対応を選んでください。対応後に、時間の進行を操作できます。";
  if (state.runState === "crisisStopped")
    return "まず緊急会議で危機への対応を確認してください。対応後に、時間の進行を操作できます。";
  if (state.runState === "completed" || state.runState === "failed")
    return "運営は終了しています。レポートと終了評価で結果を確認できます。";
  if (state.runState === "calculating")
    return "計算・保存中です。完了後に、レポートで結果を確認してください。";
  if (state.clock.progressionMode !== "auto")
    return "「1か月進める」で月を進めてください。";
  if (isTutorialTime(state))
    return "はじめの案内期間は手動で進めます。「時間の進め方」を手動にし、「1か月進める」を選んでください。";
  if (state.runState === "running")
    return state.clock.warning === "CLOCK_MOVED_BACKWARD"
      ? "端末の時刻が保存時より前のため、時間の加算を待っています。時間の進行の案内を確認してください。"
      : "自動進行中です。月を進めた後に、レポートで結果を確認してください。";
  return "時間の進行で「再開」（初回は「自動進行を始める」）を選んでください。政策の確定や再読込だけでは進みません。";
}

/** Plain content lets PageDeck paginate it, and can also be placed in the nation hub. */
export function policyConfirmationContent({
  state,
  onOpenReport,
}: {
  state: GameState;
  onOpenReport(): void;
}) {
  const policy = selectLatestConfirmedPolicy(state);
  if (!policy) return null;
  const copy = policyInputCopy[policy.type as keyof typeof policyInputCopy];
  const value = policy.inputs?.value;
  const setting =
    value === undefined
      ? "このセーブには設定値が記録されていません"
      : copy
        ? `${copy.label}：${Number((value * 100).toPrecision(12))}${copy.unit}`
        : `設定値：${value}`;
  const startLabel =
    policy.status === "cancelled"
      ? "取消前の開始予定"
      : ["draft", "previewed", "committed", "reserved"].includes(policy.status)
        ? "開始予定"
        : "開始月";
  return (
    <section className="panel" aria-label="確定した政策">
      <h3>確定した政策</h3>
      <p>
        <strong>{label(policy.type)}</strong>。{setting}。
      </p>
      <p>
        {startLabel}：{policy.activationMonth + 1}月目。状態：
        {STATUS_LABELS[policy.status]}。
      </p>
      {policy.status === "reserved" && (
        <p>
          開始予定月の月次計算で発動します。確定した時点では発動していません。
        </p>
      )}
      <p>{nextStep(state)}</p>
      <p>
        結果と変化の理由はレポートで確認できます。開始と効果が表れる時期には時間差があります。
      </p>
      <button onClick={onOpenReport}>レポートで結果を見る</button>
    </section>
  );
}
