import type { GameState } from "@macro-nation/domain";

const STOP_LABELS: Record<string, string> = {
  manual: "操作待ち",
  policy: "政策を検討中",
  event: "イベントの選択待ち",
  crisis: "危機への対応待ち",
  error: "計算・保存エラー",
  completed: "期間満了",
  failed: "運営終了",
  offlineLimit: "残りの進行があります",
  tutorial: "説明を確認中",
};

export function clockStatus(state: GameState): string {
  if (state.runState === "running") return "進行中";
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
