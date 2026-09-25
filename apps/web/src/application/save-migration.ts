import type { GameState } from "@macro-nation/domain";
import {
  createConfigSnapshot,
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
  if (state.versions.engineVersion === ENGINE_VERSION) return state;
  if (
    state.scenarioId !== "SCN-01" ||
    state.versions.engineVersion !== "0.1.7" ||
    state.versions.modelVersion !== "0.1.2" ||
    state.versions.configVersion !== "0.1.2" ||
    state.configSnapshot.snapshotVersion !== "0.1.2"
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
  const pack = await loadSCN01ConfigPack();
  const current = await createConfigSnapshot(
    pack,
    pack.scenario.parameterOverrides,
  );
  const priorScenario = {
    ...(current.normalizedConfig.scenario as Record<string, unknown>),
  };
  delete priorScenario.firstPlayable;
  if (
    stableStringify({
      ...current.normalizedConfig,
      scenario: priorScenario,
    }) !== stableStringify(oldConfig)
  )
    throw new Error("経済モデルが変更されているため保存データを移行できません");
  const migrated: GameState = {
    ...state,
    durationMode: "short",
    learningMode: "standard",
    versions: {
      ...state.versions,
      engineVersion: ENGINE_VERSION,
      configVersion: pack.manifest.configVersion,
    },
    configSnapshot: current,
  };
  await repository.save(policyStateHash(state), migrated);
  return migrated;
}
