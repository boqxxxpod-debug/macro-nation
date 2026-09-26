import type { ClockConfig, DurationMode, GameState } from "./state";

export interface DurationConfig {
  readonly id: Exclude<DurationMode, "custom">;
  readonly totalMonths: 48 | 96 | 240 | 360;
  readonly reviewIntervalMonths: number;
  readonly structuralIntervalMonths: number;
  readonly expectedPlayLabelKey: string;
  readonly learningFocusKeys: readonly string[];
}

/** Keep calendar boundaries independent of the policy decision cycle. */
export function calendarSteps(months: number, clock: ClockConfig): number {
  if (
    clock.simulationStep !== "month" ||
    !Number.isInteger(months) ||
    months < 1
  )
    throw new RangeError("A positive number of monthly steps is required");
  return months;
}

export function endMonthForState(state: GameState): number {
  const legacy = (
    state.configSnapshot.normalizedConfig.scenario as
      { durationMonths?: number } | undefined
  )?.durationMonths;
  return state.clock.endMonth ?? legacy ?? 96;
}

export function milestoneKey(
  gameId: string,
  type: "review" | "structure",
  month: number,
): string {
  return `${gameId}:${type}:${month}`;
}
