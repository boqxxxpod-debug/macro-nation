import type {
  CausalContribution,
  GameState,
  MonthlyReportSnapshot,
  VersionTuple,
} from "@macro-nation/domain";
import {
  createConfigSnapshot,
  loadSCN01ConfigPack,
} from "@macro-nation/model-config";
import {
  ENGINE_VERSION,
  createSCN01InitialState,
  policyStateHash,
  runPolicyHeadless,
  submitPolicyCommand,
  type PolicyCommand,
} from "@macro-nation/simulation-engine";
import { IndexedDbGameRepository } from "../infrastructure/game-repository";

export function browserGameRepository(): GameRepository | null {
  return typeof indexedDB === "undefined"
    ? null
    : new IndexedDbGameRepository();
}

export interface GameRepository {
  load(slotId: GameState["slotId"]): Promise<GameState | null>;
  save(expectedStateHash: string, next: GameState): Promise<void>;
  create(state: GameState): Promise<void>;
}

export function reportSnapshot(
  state: GameState,
  causal: readonly CausalContribution[] = [],
): MonthlyReportSnapshot {
  const e = state.economy;
  return {
    monthIndex: state.monthIndex,
    values: {
      realHouseholdIncome: e.indices.realHouseholdIncome,
      realGdp: e.indices.realGdp,
      inflation: e.rates.inflationAnnual,
      unemployment: e.rates.unemployment,
      policyTrust: e.sentiment.policyTrust,
      support: e.sentiment.support,
      fx: e.indices.fx,
      governmentDebtRatio: e.ratios.governmentDebtRatio,
    },
    topCauses: causal
      .flatMap((item) =>
        item.contributions.map((term) => ({
          indicatorId: item.indicatorId,
          sourceType: term.sourceType,
          sourceId: term.sourceId,
          labelKey: term.labelKey,
          delta: term.delta,
        })),
      )
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 8),
  };
}

export async function createGame(
  repository: GameRepository,
  seed: string,
  slotId: GameState["slotId"] = 1,
): Promise<GameState> {
  const pack = await loadSCN01ConfigPack();
  const configSnapshot = await createConfigSnapshot(
    pack,
    pack.scenario.parameterOverrides,
  );
  const versions: VersionTuple = {
    saveSchemaVersion: "1",
    engineVersion: ENGINE_VERSION,
    configSchemaVersion: pack.manifest.configSchemaVersion,
    modelVersion: pack.manifest.modelVersion,
    calibrationVersion: pack.manifest.calibrationVersion,
    contentVersion: pack.manifest.contentVersion,
    rngVersion: pack.manifest.rngVersion,
    configVersion: pack.manifest.configVersion,
  };
  const initial = createSCN01InitialState({
    seed,
    slotId,
    configSnapshot,
    versions,
  });
  const state: GameState = {
    ...initial,
    runState: "paused",
    history: {
      ...initial.history,
      reports: [reportSnapshot(initial)],
    },
  };
  await repository.create(state);
  return state;
}

/** One explicit month, persisted before the UI shows its result. */
export async function advanceMonth(
  repository: GameRepository,
  slotId: GameState["slotId"],
): Promise<GameState> {
  const state = await repository.load(slotId);
  if (!state) throw new Error("保存済みのゲームがありません");
  if (state.runState === "completed" || state.runState === "failed")
    throw new Error("このゲームは終了しています");
  const result = runPolicyHeadless({
    initialState: { ...state, runState: "running" },
    tickCount: 1,
  });
  if (result.failure) throw new Error(result.failure.message);
  const next: GameState = {
    ...result.finalState,
    runState: "paused",
    history: {
      ...result.finalState.history,
      snapshotMonths: [
        ...state.history.snapshotMonths,
        result.finalState.monthIndex,
      ],
      reports: [
        ...(state.history.reports ?? [reportSnapshot(state)]),
        reportSnapshot(
          result.finalState,
          result.records[0]?.diagnostics.causal,
        ),
      ],
    },
  };
  await repository.save(policyStateHash(state), next);
  return next;
}

export async function confirmPolicy(
  repository: GameRepository,
  slotId: GameState["slotId"],
  command: PolicyCommand,
): Promise<GameState> {
  return (await submitPolicyCommand(repository, slotId, command)).state;
}
