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
  onAdvance,
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
  onAdvance(): void;
}) {
  const ended = state.runState === "completed" || state.runState === "failed";
  const stopped =
    state.runState === "crisisStopped" || state.runState === "awaitingEvent";
  return (
    <div className="nation-hub">
      {state.runState === "crisisStopped" && (
        <aside className="nation-attention" aria-label="危機への対応">
          <p>国の運営をいったん止めています。対策を一緒に考えましょう。</p>
          <button onClick={onCrisis}>緊急会議を開く</button>
        </aside>
      )}
      {state.runState === "awaitingEvent" && (
        <aside className="nation-attention" aria-label="イベントへの対応">
          <p>新しい出来事が起きました。対応を選んでから先に進みましょう。</p>
          <button onClick={onEvents}>イベントの対応を選ぶ</button>
        </aside>
      )}
      {ended && (
        <aside className="nation-attention" aria-label="運営の終了">
          <p>この国の運営が終了しました。これまでの歩みを振り返れます。</p>
          <button onClick={onEnding}>終了評価を見る</button>
        </aside>
      )}
      <nav className="nation-hub-menu" aria-label="国家ビューのメニュー">
        <button aria-label="政策を考える" onClick={onPolicies}>
          政策を考える<small>専門家に相談・政策を比較</small>
        </button>
        <button aria-label="経済指標を見る" onClick={onIndicators}>
          経済指標を見る<small>国の状況・次の節目</small>
        </button>
        <button aria-label="理由を見る" onClick={onReport}>
          理由を見る<small>経済レポート・国の歩み</small>
        </button>
        <button aria-label="保存スロット" disabled={busy} onClick={onSlots}>
          保存スロット<small>別の国を開く・新しく始める</small>
        </button>
      </nav>
      <div className="nation-hub-progress">
        <span>
          スロット{state.slotId} · {period(state)}
        </span>
        <button
          className="primary"
          disabled={
            busy || stopped || ended || state.runState === "calculating"
          }
          onClick={onAdvance}
        >
          1か月進める
        </button>
      </div>
    </div>
  );
}
