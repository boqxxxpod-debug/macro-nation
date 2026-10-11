import type { ClockStopReason, GameState } from "@macro-nation/domain";
import { isAutomaticRunning } from "../application/clock-adapter";

const STOP_LABELS: Record<ClockStopReason, string> = {
  manual: "操作待ち",
  policy: "政策会議で停止",
  event: "イベントの選択待ち",
  crisis: "危機への対応待ち",
  error: "計算・保存エラー",
  completed: "予定期間を終了",
  failed: "危機で終了",
  offlineLimit: "残りの進行があります",
  tutorial: "説明を確認中",
};

export function clockStatus(state: GameState, busy = false): string {
  if (busy || state.runState === "calculating") return "計算・保存中";
  if (isAutomaticRunning(state))
    return state.clock.warning === "CLOCK_MOVED_BACKWARD"
      ? "時刻の調整待ち"
      : "進行中";
  const reason =
    state.runState === "awaitingEvent"
      ? "event"
      : state.runState === "crisisStopped"
        ? "crisis"
        : state.runState === "completed" || state.runState === "failed"
          ? state.runState
          : (state.clock.stopReason ?? "manual");
  return `停止中 · ${STOP_LABELS[reason] ?? "操作待ち"}`;
}
