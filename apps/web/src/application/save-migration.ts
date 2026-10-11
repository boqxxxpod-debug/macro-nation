import type { GameState } from "@macro-nation/domain";
import {
  loadSCN01ConfigPack,
  sha256Hex,
  stableStringify,
} from "@macro-nation/model-config";
import {
  ENGINE_VERSION,
  policyStateHash,
} from "@macro-nation/simulation-engine";
import type { GameRepository } from "./game-service";

/** Economic snapshots stay unchanged when schema 3 adds web clock metadata. */
export async function migrateFirstPlayableSave(
  repository: GameRepository,
  state: GameState,
): Promise<GameState> {
  if (!["1", "2", "3"].includes(state.versions.saveSchemaVersion))
    throw new Error("保存データの版に対応していません。元の版で再開してください");
  if (
    state.versions.engineVersion === ENGINE_VERSION &&
    state.clock.endMonth !== undefined &&
    state.versions.saveSchemaVersion === "3" &&
    state.clock.progressionMode !== undefined &&
    state.clock.lastProcessedWallClockMs !== undefined &&
    state.clock.remainderMs !== undefined
  )
    return state;
  if (
    state.scenarioId !== "SCN-01" ||
    !["0.1.7", "0.1.8", ENGINE_VERSION].includes(state.versions.engineVersion)
  )
    throw new Error(
      "保存データの版に対応していません。元の版で再開してください",
    );
  const oldConfig = state.configSnapshot.normalizedConfig;
  if (
    (await sha256Hex(stableStringify(oldConfig))) !==
    state.configSnapshot.configHash
  )
    throw new Error("保存済みConfig Snapshotの整合性を確認できません");
  // Preserve the old run's economic and calibration snapshot. Only the 0.1.7
  // playable-rule metadata was missing; it cannot influence Engine equations.
  const needsPlayableRules = state.versions.engineVersion === "0.1.7";
  const pack = needsPlayableRules ? await loadSCN01ConfigPack() : null;
  const normalizedConfig = needsPlayableRules
    ? {
        ...oldConfig,
        scenario: {
          ...(oldConfig.scenario as Record<string, unknown>),
          firstPlayable: pack!.scenario.firstPlayable,
        },
      }
    : oldConfig;
  const configSnapshot = needsPlayableRules
    ? {
        ...state.configSnapshot,
        snapshotVersion: "0.1.3",
        normalizedConfig,
        configHash: await sha256Hex(stableStringify(normalizedConfig)),
      }
    : state.configSnapshot;
  const hasDuration = state.versions.engineVersion !== "0.1.7" && state.clock.endMonth !== undefined &&
    ["2", "3"].includes(state.versions.saveSchemaVersion);
  const durationMode = hasDuration ? state.durationMode ?? "short" : "short";
  const needsClockDefaults = state.clock.progressionMode === undefined;
  const runState = needsClockDefaults &&
    (state.runState === "running" || state.runState === "calculating")
    ? "paused" : state.runState;
  const migrated: GameState = {
    ...state,
    runState,
    durationMode,
    learningMode: state.learningMode ?? "standard",
    clock: {
      ...state.clock,
      durationMode,
      endMonth: hasDuration ? state.clock.endMonth! : 48,
      progressionMode: needsClockDefaults ? "manual" : state.clock.progressionMode ?? "manual",
      lastProcessedWallClockMs: needsClockDefaults ? null : state.clock.lastProcessedWallClockMs ?? null,
      remainderMs: needsClockDefaults ? 0 : state.clock.remainderMs ?? 0,
      ...(needsClockDefaults ? {
        stopReason: runState === "awaitingEvent" ? "event"
          : runState === "crisisStopped" ? "crisis"
          : runState === "completed" ? "completed"
          : runState === "failed" ? "failed" : "manual",
      } as const : {}),
    },
    history: {
      ...state.history,
      appliedMilestones: state.history.appliedMilestones ?? [],
      reviews: state.history.reviews ?? [],
      entries: state.history.entries ?? [],
    },
    versions: {
      ...state.versions,
      engineVersion: ENGINE_VERSION,
      saveSchemaVersion: "3",
      ...(needsPlayableRules ? { configVersion: "0.1.3" } : {}),
    },
    configSnapshot,
  };
  try {
    await repository.save(policyStateHash(state), migrated);
  } catch (error) {
    // React StrictMode and another tab can read the same old generation. Only
    // reuse an identical committed migration; a different game is never written.
    const latest = await repository.load(state.slotId);
    if (latest && policyStateHash(latest) === policyStateHash(migrated)) return latest;
    throw error;
  }
  return migrated;
}
