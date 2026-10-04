import type {
  CausalContribution,
  DurationMode,
  GameState,
  MonthlyReportSnapshot,
  ReactionSnapshot,
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
import {
  forecastRecord,
  learningEntriesForReport,
  type ForecastCapture,
} from "./learning";
import { withNationalHistory } from "./history";
import {
  isAutomaticRunning,
  isTutorialTime,
  queueElapsed,
  stopClock,
} from "./clock-adapter";

export function browserGameRepository(): GameRepository | null {
  return typeof indexedDB === "undefined"
    ? null
    : new IndexedDbGameRepository();
}

export interface GameRepository {
  load(slotId: GameState["slotId"]): Promise<GameState | null>;
  loadSlot?(slotId: GameState["slotId"]): Promise<SlotLoadResult>;
  save(
    expectedStateHash: string,
    next: GameState,
    shouldCommit?: () => boolean,
  ): Promise<void>;
  create(state: GameState, startCommandId?: string): Promise<void>;
}

export interface SlotLoadResult {
  readonly state: GameState | null;
  readonly recovered: boolean;
  readonly reason?: string;
}

export function reportSnapshot(
  state: GameState,
  causal: readonly CausalContribution[] = [],
  reactions: readonly ReactionSnapshot[] = [],
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
    reactions,
  };
}

export async function createGame(
  repository: GameRepository,
  seed: string,
  slotId: GameState["slotId"] = 1,
  learningMode: NonNullable<GameState["learningMode"]> = "learning",
  durationMode: Exclude<DurationMode, "custom"> = "short",
  difficulty: GameState["difficulty"] = "intro",
  startCommandId?: string,
): Promise<GameState> {
  const pack = await loadSCN01ConfigPack();
  const configSnapshot = await createConfigSnapshot(
    pack,
    pack.scenario.parameterOverrides,
  );
  const versions: VersionTuple = {
    saveSchemaVersion: "3",
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
    difficulty,
    durationMode,
    learningMode,
    pendingOfflineSteps: 0,
    clock: {
      ...initial.clock,
      progressionMode: "manual",
      lastProcessedWallClockMs: null,
      remainderMs: 0,
      stopReason: "manual",
    },
    history: {
      ...initial.history,
      reports: [reportSnapshot(initial)],
    },
  };
  await repository.create(state, startCommandId);
  // An idempotent retry may have found the already committed start command.
  // Always return the durable value rather than a newly generated duplicate.
  return (await repository.load(slotId)) ?? state;
}

/** One explicit month, persisted before the UI shows its result. */
export async function advanceMonth(
  repository: GameRepository,
  slotId: GameState["slotId"],
  fromOffline = false,
  compute: MonthCalculator = calculateMonth,
): Promise<GameState> {
  const state = await repository.load(slotId);
  if (!state)
    throw new Error(
      "保存したゲームが見つかりません。「はじめる・続きから」で保存先を確認しましょう。",
    );
  const next = await compute(state, fromOffline);
  await repository.save(policyStateHash(state), next);
  return next;
}

export type MonthCalculator = (
  state: GameState,
  fromAutomatic: boolean,
) => GameState | Promise<GameState>;

/** Pure monthly calculation, shared by explicit steps and the browser Worker. */
export function calculateMonth(
  state: GameState,
  fromOffline = false,
): GameState {
  if (
    state.runState === "completed" ||
    state.runState === "failed" ||
    state.runState === "crisisStopped" ||
    state.runState === "awaitingEvent" ||
    state.runState === "calculating"
  )
    throw new Error(
      "運営の終了時や危機への対応中・イベントの選択中は、月を進められません。ホームで対応を確認してから再開できます。",
    );
  if (isAutomaticRunning(state) && !fromOffline)
    throw new Error("自動進行を停止してから月を進めてください");
  if (fromOffline && !isAutomaticRunning(state))
    throw new Error("自動進行を再開してから残りの月を進めてください");
  const result = runPolicyHeadless({
    initialState: { ...state, runState: "running" },
    tickCount: 1,
    // Offline progress is the same sequence of monthly ticks as foreground
    // progress. Keep explanation data in the durable state as well as the
    // economic result so replaying an elapsed period produces the same save.
    deriveReactions: true,
  });
  if (result.failure) throw new Error(result.failure.message);
  const rules = firstPlayableRules(state);
  const critical = criticalCondition(result.finalState, rules.crisis);
  const priorCritical = state.crisisCounters.unresolved ?? 0;
  const runState =
    result.finalState.runState === "failed" ||
    (critical && priorCritical >= rules.unresolvedCrisisMonthsToFail)
      ? "failed"
      : result.finalState.monthIndex >= endMonthForState(result.finalState)
        ? "completed"
        : critical
          ? "crisisStopped"
          : result.finalState.runState === "awaitingEvent"
            ? "awaitingEvent"
            : fromOffline && isAutomaticRunning(state)
              ? "running"
              : "paused";
  const monthlyReport = reportSnapshot(
    result.finalState,
    result.records[0]?.diagnostics.causal,
    result.records[0]?.diagnostics.reactions,
  );
  const nextWithoutLearning: GameState = {
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
        monthlyReport,
      ],
    },
  };
  const withHistory: GameState = withNationalHistory({
    ...nextWithoutLearning,
    history: {
      ...nextWithoutLearning.history,
      learningEntries: [
        ...(state.history.learningEntries ?? []),
        ...learningEntriesForReport(nextWithoutLearning, monthlyReport),
      ],
    },
  });
  const reason =
    runState === "awaitingEvent"
      ? "event"
      : runState === "crisisStopped"
        ? "crisis"
        : runState === "completed"
          ? "completed"
          : runState === "failed"
            ? "failed"
            : "manual";
  const next =
    runState === "running" ? withHistory : stopClock(withHistory, reason);
  return next;
}

/** The caller supplies elapsed seconds; the Engine never reads the browser clock. */
export async function catchUpOffline(
  repository: GameRepository,
  slotId: GameState["slotId"],
  elapsedSeconds: number,
  onProgress?: (completed: number, pending: number) => boolean | void,
  compute: MonthCalculator = calculateMonth,
): Promise<GameState> {
  let state = await repository.load(slotId);
  if (!state)
    throw new Error(
      "保存したゲームが見つかりません。「はじめる・続きから」で保存先を確認しましょう。",
    );
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0)
    throw new RangeError(
      "離れていた時間を確認できませんでした。もう一度、保存したゲームを読み込みましょう。",
    );
  if (!isAutomaticRunning(state)) return state;
  if (isTutorialTime(state)) {
    const stopped = stopClock({ ...state, runState: "paused" }, "tutorial");
    await repository.save(policyStateHash(state), stopped);
    return stopped;
  }
  const queued = queueElapsed(state, elapsedSeconds * 1000);
  if (policyStateHash(queued) !== policyStateHash(state)) {
    await repository.save(policyStateHash(state), queued);
    state = queued;
  }
  return processPendingSteps(
    repository,
    slotId,
    state.clock.config.offlineMaxSteps,
    onProgress,
    compute,
  );
}

/** Both Clock Adapter paths use these same sequential, individually saved months. */
export async function processPendingSteps(
  repository: GameRepository,
  slotId: GameState["slotId"],
  maximumSteps: number,
  onProgress?: (completed: number, pending: number) => boolean | void,
  compute: MonthCalculator = calculateMonth,
): Promise<GameState> {
  if (!Number.isSafeInteger(maximumSteps) || maximumSteps < 0)
    throw new RangeError("進行月数の設定を確認できません");
  let state = await repository.load(slotId);
  if (!state) throw new Error("保存済みのゲームがありません");
  if (!isAutomaticRunning(state)) return state;
  if (isTutorialTime(state)) {
    const stopped = stopClock({ ...state, runState: "paused" }, "tutorial");
    await repository.save(policyStateHash(state), stopped);
    return stopped;
  }
  const count = Math.min(state.pendingOfflineSteps ?? 0, maximumSteps, 96);
  let lastProgressMs = Date.now();
  for (let index = 0; index < count; index += 1) {
    if (!isAutomaticRunning(state)) break;
    state = await advanceMonth(repository, slotId, true, compute);
    if (
      (index + 1) % 4 === 0 ||
      Date.now() - lastProgressMs >= 250 ||
      index + 1 === count ||
      !isAutomaticRunning(state)
    ) {
      lastProgressMs = Date.now();
      if (
        onProgress?.(index + 1, state.pendingOfflineSteps ?? 0) === false &&
        isAutomaticRunning(state)
      ) {
        const stopped = stopClock({ ...state, runState: "paused" }, "manual");
        await repository.save(policyStateHash(state), stopped);
        state = stopped;
        break;
      }
    }
  }
  if (isAutomaticRunning(state) && (state.pendingOfflineSteps ?? 0) > 0) {
    const stopped = stopClock({ ...state, runState: "paused" }, "offlineLimit");
    await repository.save(policyStateHash(state), stopped);
    state = stopped;
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
    throw new Error(
      "このゲームの終了条件と危機条件を確認できませんでした。別の保存先で新しく始めることができます。",
    );
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
    throw new Error(
      "いまは危機への対応待ちではありません。ホームで現在の状況を確認しましょう。",
    );
  const next = stopClock({ ...state, runState: "paused" }, "manual");
  await repository.save(policyStateHash(state), next);
  return next;
}

/** Resolve the current event once. Choice impact is retained separately for audit. */
export async function resolveEvent(
  repository: GameRepository,
  slotId: GameState["slotId"],
  choiceId: "protect-households" | "protect-businesses" | "balanced",
): Promise<GameState> {
  const state = await repository.load(slotId);
  const eventId = state?.events.pendingChoiceEventId;
  if (!state || state.runState !== "awaitingEvent" || !eventId)
    throw new Error(
      "いまは対応を選ぶイベントがありません。ホームで現在の状況を確認しましょう。",
    );
  const expectedHash = policyStateHash(state);
  const choiceRate = choiceId === "balanced" ? 0.15 : 0.2;
  const occurrences = [...(state.events.occurrences ?? [])];
  const index = occurrences.findLastIndex(
    (item) => item.eventId === eventId && !item.choiceId,
  );
  if (index < 0)
    throw new Error(
      "対応するイベントの記録を確認できませんでした。保存したゲームを読み込んで、もう一度状況を確認しましょう。",
    );
  const occurrence = occurrences[index]!;
  const choiceMitigation = -occurrence.baselineDamage * choiceRate;
  occurrences[index] = {
    ...occurrence,
    choiceId,
    choiceMitigation,
  };
  const remainingEvents = Object.fromEntries(
    Object.entries(state.events).filter(
      ([key]) => key !== "pendingChoiceEventId",
    ),
  ) as unknown as GameState["events"];
  const next: GameState = {
    ...structuredClone(state),
    runState: "paused",
    clock: {
      ...state.clock,
      lastProcessedWallClockMs: null,
      stopReason: "manual",
    },
    events: {
      ...remainingEvents,
      occurrences,
    },
  };
  const path = occurrence.targetPath.split(".");
  let target: Record<string, unknown> = next as unknown as Record<
    string,
    unknown
  >;
  for (const part of path.slice(0, -1))
    target = target[part] as Record<string, unknown>;
  const key = path.at(-1)!;
  target[key] = (target[key] as number) + choiceMitigation;
  await repository.save(expectedHash, next);
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
  forecast?: Omit<ForecastCapture, "decisionId" | "month">,
): Promise<GameState> {
  const state = await repository.load(slotId);
  if (!state) throw new Error("保存済みのゲームがありません");
  if (
    state.runState === "running" ||
    state.runState === "calculating" ||
    state.runState === "awaitingEvent"
  )
    throw new Error(
      "時間を止め、イベントへの対応を終えてから政策を確定してください",
    );
  return (
    await submitPolicyCommand(repository, slotId, command, (committed) => {
      if (!forecast) return committed;
      const record = forecastRecord({
        ...forecast,
        decisionId: command.commandId,
        month: committed.monthIndex,
      });
      return withNationalHistory({
        ...committed,
        history: {
          ...committed.history,
          forecastRecords: [
            ...(committed.history.forecastRecords ?? []).filter(
              (item) => item.recordId !== record.recordId,
            ),
            record,
          ],
        },
      });
    })
  ).state;
}
