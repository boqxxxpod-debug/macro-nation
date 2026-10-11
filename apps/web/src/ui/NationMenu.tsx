import type { GameState } from "@macro-nation/domain";
import { period } from "./game-format";

export function NationMenu({
  state,
  busy,
  onPolicies,
  onIndicators,
  onReport,
  onSlots,
  onCrisis,
  onEvents,
  onEnding,
}: {
  state: GameState;
  busy: boolean;
  onPolicies(): void;
  onIndicators(): void;
  onReport(): void;
  onSlots(): void;
  onCrisis(): void;
  onEvents(): void;
  onEnding(): void;
}) {
  const ended = state.runState === "completed" || state.runState === "failed";
  return (
    <div className="nation-hub">
      {state.runState === "crisisStopped" && (
        <aside className="nation-attention" aria-label="危機への対応">
          <button onClick={onCrisis}>緊急会議を開く</button>
        </aside>
      )}
      {state.runState === "awaitingEvent" && (
        <aside className="nation-attention" aria-label="イベントへの対応">
          <button onClick={onEvents}>イベントの対応を選ぶ</button>
        </aside>
      )}
      {ended && (
        <aside className="nation-attention" aria-label="運営の終了">
          <button onClick={onEnding}>終了評価を見る</button>
        </aside>
      )}
      <nav className="nation-hub-menu" aria-label="国家ビューのメニュー">
        <button aria-label="政策を考える" onClick={onPolicies}>
          政策
        </button>
        <button aria-label="経済指標を見る" onClick={onIndicators}>
          指標
        </button>
        <button aria-label="理由を見る" onClick={onReport}>
          レポート
        </button>
        <button aria-label="保存スロット" disabled={busy} onClick={onSlots}>
          保存先
        </button>
      </nav>
      <span className="sr-only">
        保存先{state.slotId} · {period(state)}
      </span>
    </div>
  );
}
