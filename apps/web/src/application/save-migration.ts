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

/** The 0.1.7 to 0.1.8 transition adds only SCN-01 play rules to the snapshot. */
export async function migrateFirstPlayableSave(
  repository: GameRepository,
  state: GameState,
): Promise<GameState> {
  if (
    state.versions.engineVersion === ENGINE_VERSION &&
    state.clock.endMonth !== undefined &&
    state.versions.saveSchemaVersion === "2"
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
  const durationMode = "short" as const;
  const migrated: GameState = {
    ...state,
    durationMode,
    learningMode: state.learningMode ?? "standard",
    clock: { ...state.clock, durationMode, endMonth: 48 },
    history: {
      ...state.history,
      appliedMilestones: state.history.appliedMilestones ?? [],
      reviews: state.history.reviews ?? [],
    },
    versions: {
      ...state.versions,
      engineVersion: ENGINE_VERSION,
      saveSchemaVersion: "2",
      ...(needsPlayableRules ? { configVersion: "0.1.3" } : {}),
    },
    configSnapshot,
  };
  await repository.save(policyStateHash(state), migrated);
  return migrated;
}
