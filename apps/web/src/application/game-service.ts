import type {
  CausalContribution,
  DurationMode,
  GameState,
  MonthlyReportSnapshot,
  VersionTuple,
} from "@macro-nation/domain";
import { endMonthForState } from "@macro-nation/domain";
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
      manufacturing: e.industries.manufacturing.productionIndex,
      agriculture: e.industries.agricultureResources.productionIndex,
      exports: e.flows.exports,
      imports: e.flows.imports,
      transport: e.infrastructure.transport,
      energy: e.infrastructure.energy,
      consumption: e.flows.consumption,
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
  learningMode: NonNullable<GameState["learningMode"]> = "learning",
  durationMode: Exclude<DurationMode, "custom"> = "short",
): Promise<GameState> {
  const pack = await loadSCN01ConfigPack();
  const configSnapshot = await createConfigSnapshot(
    pack,
    pack.scenario.parameterOverrides,
  );
  const versions: VersionTuple = {
    saveSchemaVersion: "2",
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
    durationMode,
  });
  const state: GameState = {
    ...initial,
    runState: "paused",
    difficulty: "intro",
    durationMode,
    learningMode,
    pendingOfflineSteps: 0,
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
  fromOffline = false,
): Promise<GameState> {
  const state = await repository.load(slotId);
  if (!state) throw new Error("保存済みのゲームがありません");
  if (
    state.runState === "completed" ||
    state.runState === "failed" ||
    state.runState === "crisisStopped"
  )
    throw new Error("終了または危機停止中です。危機対応後に再開してください");
  const result = runPolicyHeadless({
    initialState: { ...state, runState: "running" },
    tickCount: 1,
  });
  if (result.failure) throw new Error(result.failure.message);
  const rules = firstPlayableRules(state);
  const critical = criticalCondition(result.finalState, rules.crisis);
  const priorCritical = state.crisisCounters.unresolved ?? 0;
  const runState = critical
    ? priorCritical >= rules.unresolvedCrisisMonthsToFail
      ? "failed"
      : "crisisStopped"
    : result.finalState.monthIndex >= endMonthForState(result.finalState)
      ? "completed"
      : "paused";
  const next: GameState = {
    ...result.finalState,
    runState,
    ...(fromOffline
      ? {
          pendingOfflineSteps: Math.max(
            0,
            (state.pendingOfflineSteps ?? 0) - 1,
          ),
        }
      : state.pendingOfflineSteps !== undefined
        ? { pendingOfflineSteps: state.pendingOfflineSteps }
        : {}),
    crisisCounters: {
      ...state.crisisCounters,
      unresolved: critical ? priorCritical + 1 : 0,
    },
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

/** The caller supplies elapsed seconds; the Engine never reads the browser clock. */
export async function catchUpOffline(
  repository: GameRepository,
  slotId: GameState["slotId"],
  elapsedSeconds: number,
  onProgress?: (completed: number, pending: number) => boolean | void,
): Promise<GameState> {
  let state = await repository.load(slotId);
  if (!state) throw new Error("保存済みのゲームがありません");
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0)
    throw new RangeError("経過時間が正しくありません");
  if (state.runState === "running") {
    const newSteps = Math.floor(
      elapsedSeconds / state.clock.config.realSecondsPerStep,
    );
    if (!Number.isSafeInteger(newSteps + (state.pendingOfflineSteps ?? 0)))
      throw new RangeError("オフライン経過が長すぎます");
    if (newSteps > 0) {
      const queued = {
        ...state,
        pendingOfflineSteps: (state.pendingOfflineSteps ?? 0) + newSteps,
      };
      await repository.save(policyStateHash(state), queued);
      state = queued;
    }
  }
  const count = Math.min(
    state.pendingOfflineSteps ?? 0,
    state.clock.config.offlineMaxSteps,
    96,
  );
  for (let index = 0; index < count; index += 1) {
    if (
      state.runState === "completed" ||
      state.runState === "failed" ||
      state.runState === "crisisStopped"
    )
      break;
    state = await advanceMonth(repository, slotId, true);
    if ((index + 1) % 12 === 0 || index + 1 === count) {
      if (onProgress?.(index + 1, state.pendingOfflineSteps ?? 0) === false)
        break;
    }
  }
  return state;
}

interface PlayRules {
  readonly durationMonths: number;
  readonly crisis: {
    readonly inflationAnnual: number;
    readonly unemployment: number;
    readonly supportBelow: number;
    readonly foreignReservesBelow: number;
  };
  readonly unresolvedCrisisMonthsToFail: number;
}

export function firstPlayableRules(state: GameState): PlayRules {
  const scenario = state.configSnapshot.normalizedConfig.scenario as {
    durationMonths: number;
    firstPlayable: Omit<PlayRules, "durationMonths">;
  };
  if (!scenario?.firstPlayable)
    throw new Error("シナリオの終了・危機条件がありません");
  return { durationMonths: scenario.durationMonths, ...scenario.firstPlayable };
}

function criticalCondition(
  state: GameState,
  thresholds: PlayRules["crisis"],
): boolean {
  const e = state.economy;
  return (
    e.rates.inflationAnnual >= thresholds.inflationAnnual ||
    e.rates.unemployment >= thresholds.unemployment ||
    e.sentiment.support < thresholds.supportBelow ||
    e.stocks.foreignReserves < thresholds.foreignReservesBelow
  );
}

/** An explicit choice is saved before another month may run. */
export async function resumeCrisis(
  repository: GameRepository,
  slotId: GameState["slotId"],
): Promise<GameState> {
  const state = await repository.load(slotId);
  if (!state || state.runState !== "crisisStopped")
    throw new Error("再開できる危機がありません");
  const next: GameState = { ...state, runState: "paused" };
  await repository.save(policyStateHash(state), next);
  return next;
}

export interface EndingResult {
  readonly axes: Readonly<
    Record<
      "living" | "growth" | "stability" | "sustainability" | "trust",
      number
    >
  >;
  readonly score: number;
  readonly rank: "S" | "A" | "B" | "C" | "D" | "F";
}

export function evaluateEnding(state: GameState): EndingResult {
  const first = state.history.reports?.[0];
  const e = state.economy;
  const clip = (value: number) => Math.max(0, Math.min(100, value));
  const living = clip(
    50 +
      (e.indices.realHouseholdIncome /
        (first?.values.realHouseholdIncome || 100) -
        1) *
        100,
  );
  const growth = clip(
    50 + (e.indices.realGdp / (first?.values.realGdp || 100) - 1) * 100,
  );
  const stability = clip(
    100 -
      Math.abs(e.rates.inflationAnnual - 0.02) * 500 -
      e.rates.unemployment * 200,
  );
  const sustainability = clip(100 - e.ratios.governmentDebtRatio * 40);
  const trust = clip(e.sentiment.policyTrust);
  const axes = { living, growth, stability, sustainability, trust };
  const weighted =
    living * 0.3 +
    growth * 0.25 +
    stability * 0.2 +
    sustainability * 0.15 +
    trust * 0.1;
  const score = Math.min(weighted, 60 + Math.min(...Object.values(axes)) * 0.4);
  return {
    axes,
    score,
    rank:
      state.runState === "failed"
        ? "F"
        : score >= 90
          ? "S"
          : score >= 75
            ? "A"
            : score >= 60
              ? "B"
              : score >= 45
                ? "C"
                : "D",
  };
}

export async function confirmPolicy(
  repository: GameRepository,
  slotId: GameState["slotId"],
  command: PolicyCommand,
): Promise<GameState> {
  return (await submitPolicyCommand(repository, slotId, command)).state;
}
