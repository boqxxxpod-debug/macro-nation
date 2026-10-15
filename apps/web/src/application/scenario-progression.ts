import type { GameState, ScenarioId } from "@macro-nation/domain";

/** Device-level progress is independent of individual saved economic runs. */
export interface ScenarioProgression {
  readonly completedScenarioIds: readonly ScenarioId[];
}

export const MVP_SCENARIO_IDS = ["SCN-01", "SCN-02", "SCN-03"] as const;

export function emptyScenarioProgression(): ScenarioProgression {
  return { completedScenarioIds: [] };
}

/** Only committed completed runs count; a failed run grants no unlock. */
export function progressionFromStates(
  states: readonly GameState[],
  previous: ScenarioProgression = emptyScenarioProgression(),
): ScenarioProgression {
  const completed = new Set(previous.completedScenarioIds);
  for (const state of states)
    if (state.runState === "completed") completed.add(state.scenarioId);
  return {
    completedScenarioIds: [...completed].sort(),
  };
}

export function unlockedScenarioIds(
  progression: ScenarioProgression,
): readonly ScenarioId[] {
  return progression.completedScenarioIds.includes("SCN-01")
    ? MVP_SCENARIO_IDS
    : ["SCN-01"];
}
