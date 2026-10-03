import type { ClockStopReason, GameState } from "@macro-nation/domain";

/** The guided first period ends at the saved scenario's configured boundary. */
export function tutorialStepLimit(state: GameState): number {
  const scenario = state.configSnapshot.normalizedConfig.scenario as
    | {
        readonly firstPlayable?: { readonly tutorialQuarters?: number };
      }
    | undefined;
  const quarters = scenario?.firstPlayable?.tutorialQuarters ?? 0;
  return Number.isSafeInteger(quarters) && quarters >= 0
    ? quarters * state.clock.config.policyCycleSteps
    : 0;
}

export function isTutorialTime(state: GameState): boolean {
  return (
    state.scenarioId === "SCN-01" &&
    state.learningMode === "learning" &&
    state.monthIndex < tutorialStepLimit(state)
  );
}

export function isAutomaticRunning(state: GameState): boolean {
  return state.clock.progressionMode === "auto" && state.runState === "running";
}

export function stepMilliseconds(state: GameState): number {
  const period = state.clock.config.realSecondsPerStep * 1000;
  if (!Number.isFinite(period) || period <= 0)
    throw new RangeError("時間の設定を確認できません");
  return period;
}

/** The earned budget is checkpointed before any monthly calculation begins. */
export function queueElapsed(state: GameState, elapsedMs: number): GameState {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
    throw new RangeError("経過時間が正しくありません");
  if (!isAutomaticRunning(state)) return state;
  const period = stepMilliseconds(state);
  const fraction = state.clock.remainderMs ?? 0;
  if (!Number.isFinite(fraction) || fraction < 0 || fraction >= period)
    throw new RangeError("保存された時間の端数を確認できません");
  const total = fraction + elapsedMs;
  const steps = Math.floor(total / period);
  const pending = (state.pendingOfflineSteps ?? 0) + steps;
  if (!Number.isSafeInteger(pending))
    throw new RangeError("オフライン経過が長すぎます");
  return {
    ...state,
    pendingOfflineSteps: pending,
    clock: { ...state.clock, remainderMs: total - steps * period },
  };
}

/** A backwards wall clock earns no time until it passes the saved checkpoint. */
export function checkpointClock(state: GameState, nowMs: number): GameState {
  if (!Number.isFinite(nowMs) || nowMs < 0)
    throw new RangeError("現在時刻が正しくありません");
  if (!isAutomaticRunning(state)) return state;
  const prior = state.clock.lastProcessedWallClockMs ?? nowMs;
  if (!Number.isFinite(prior) || prior < 0)
    throw new RangeError("保存された時刻を確認できません");
  const next = queueElapsed(state, Math.max(0, nowMs - prior));
  return {
    ...next,
    clock: {
      ...next.clock,
      lastProcessedWallClockMs: Math.max(prior, nowMs),
    },
  };
}

export function stopClock(
  state: GameState,
  reason: ClockStopReason,
): GameState {
  return {
    ...state,
    clock: {
      ...state.clock,
      lastProcessedWallClockMs: null,
      stopReason: reason,
    },
  };
}
