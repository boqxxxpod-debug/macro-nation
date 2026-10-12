import type { GameState } from "@macro-nation/domain";
import { period } from "./game-format";
import { clockStatus } from "./time-status";
import { isTutorialTime, tutorialStepLimit } from "../application/game-clock";

function remainingTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface TimeControlsProps {
  state: GameState;
  remainingMs: number;
  busy: boolean;
  hasStarted: boolean;
  onModeChange(mode: "manual" | "auto"): void;
  onStart(): void;
  onPause(): void;
  onManualStep(): void;
}

/** The same clock controls remain available while viewing home or the nation. */
export function TimeControls({
  state,
  remainingMs,
  busy,
  hasStarted,
  onModeChange,
  onStart,
  onPause,
  onManualStep,
}: TimeControlsProps) {
  const mode = state.clock.progressionMode ?? "manual";
  const tutorial = isTutorialTime(state);
  const blocked = [
    "awaitingEvent",
    "crisisStopped",
    "completed",
    "failed",
  ].includes(state.runState);
  const intervalSeconds = state.clock.config.realSecondsPerStep;
  const speed =
    intervalSeconds % 60 === 0
      ? `${intervalSeconds / 60}分で1か月`
      : `${intervalSeconds}秒で1か月`;

  return (
    <section className="panel time-controls" aria-label="時間の進行">
      <div className="time-controls-summary">
        <strong>{period(state)}</strong>
        <span>{mode === "auto" ? "自動" : "手動"}</span>
        <p role="status">{clockStatus(state, busy)}</p>
        <p aria-label="次の月までの残り時間" aria-live="off">
          次の月まで あと {remainingTime(remainingMs)}
          {mode === "manual" && <small>手動操作で進みます</small>}
        </p>
      </div>
      <div className="time-controls-actions">
        <label>
          <span className="time-controls-label">時間の進め方</span>
          <select
            value={mode}
            disabled={busy}
            onChange={(event) =>
              onModeChange(event.target.value as "manual" | "auto")
            }
          >
            <option value="manual">手動（1か月ずつ）</option>
            <option value="auto">自動（{speed}）</option>
          </select>
        </label>
        <div className="actions">
          {mode === "auto" && (
            <button
              type="button"
              className="primary"
              disabled={
                busy || blocked || (tutorial && state.runState !== "running")
              }
              onClick={state.runState === "running" ? onPause : onStart}
            >
              {state.runState === "running"
                ? "一時停止"
                : hasStarted
                  ? "再開"
                  : "自動進行を始める"}
            </button>
          )}
          <button
            type="button"
            disabled={busy || blocked || mode === "auto"}
            onClick={onManualStep}
          >
            1か月進める
          </button>
        </div>
      </div>
      {tutorial && (
        <p className="time-controls-note">
          はじめの{tutorialStepLimit(state)}
          か月は手動で進めます。
        </p>
      )}
      {(state.pendingOfflineSteps ?? 0) > 0 && (
        <p className="time-controls-note">
          未反映の時間：{state.pendingOfflineSteps}
          か月。再開すると続きを反映します。
        </p>
      )}
      {state.clock.stopReason === "error" && (
        <p className="time-controls-note">
          最後に保存できた月で止めました。保存環境を確認してから再開してください。
        </p>
      )}
      {mode === "auto" && state.clock.warning === "CLOCK_MOVED_BACKWARD" && (
        <p className="time-controls-note" role="status">
          端末の時刻が保存時より前のため、時間の加算を待っています。
          {state.runState === "running" ? "一時停止してから" : "時間の進行を"}
          再開すると、現在の時刻を基準に進められます。
        </p>
      )}
    </section>
  );
}
