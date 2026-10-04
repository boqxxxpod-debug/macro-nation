import type { ClockStopReason, GameState } from "@macro-nation/domain";
import { policyStateHash } from "@macro-nation/simulation-engine";
import {
  advanceMonth,
  catchUpOffline,
  processPendingSteps,
  type GameRepository,
} from "./game-service";
import {
  checkpointClock,
  isAutomaticRunning,
  isTutorialTime,
  stepMilliseconds,
  stopClock,
} from "./clock-adapter";
import {
  OfflineMonthClient,
  type AutomaticMonthClient,
} from "../infrastructure/offline-month-client";

export { isTutorialTime, tutorialStepLimit } from "./clock-adapter";

export interface GameClockSnapshot {
  readonly state: GameState | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly remainingMs: number;
}

interface SynchronizeOptions {
  readonly offline?: boolean;
  readonly onProgress?: (completed: number, pending: number) => boolean | void;
}

class SelectionChanged extends Error {}

/** One queue spans navigation, policies, foreground ticks and return processing. */
export class GameClockController {
  private state: GameState | null = null;
  private error: string | null = null;
  private readonly errorStops = new Map<string, string>();
  private generation = 0;
  private queued = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private readonly nowMs: () => number;
  private readonly monthClient: AutomaticMonthClient;

  constructor(
    private readonly repository: GameRepository,
    options: {
      readonly nowMs?: () => number;
      readonly monthClient?: AutomaticMonthClient;
    } = {},
  ) {
    this.nowMs = options.nowMs ?? Date.now;
    this.monthClient = options.monthClient ?? new OfflineMonthClient();
  }

  get snapshot(): GameClockSnapshot {
    const state = this.state;
    const elapsed =
      state && isAutomaticRunning(state)
        ? Math.max(
            0,
            this.nowMs() -
              (state.clock.lastProcessedWallClockMs ?? this.nowMs()),
          )
        : 0;
    return {
      state,
      busy: this.queued > 0,
      error: this.error,
      remainingMs: state
        ? Math.max(
            0,
            stepMilliseconds(state) - (state.clock.remainderMs ?? 0) - elapsed,
          )
        : 0,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  selectGame(state: GameState | null): void {
    this.generation += 1;
    this.monthClient.cancel();
    this.error = state ? (this.errorStops.get(state.gameId) ?? null) : null;
    this.state =
      state && this.error && isAutomaticRunning(state)
        ? stopClock({ ...state, runState: "paused" }, "error")
        : state;
    this.queued = 0;
    this.queue = Promise.resolve();
    this.publish();
  }

  dispose(): void {
    this.selectGame(null);
    this.listeners.clear();
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }

  private run(
    operation: (
      repository: GameRepository,
      slotId: GameState["slotId"],
    ) => Promise<GameState>,
  ): Promise<GameState | null> {
    const selected = this.state;
    const generation = this.generation;
    if (!selected) return Promise.resolve(null);
    const assertSelected = () => {
      if (
        this.generation !== generation ||
        this.state?.gameId !== selected.gameId
      )
        throw new SelectionChanged();
    };
    const guarded: GameRepository = {
      load: async (slotId) => {
        assertSelected();
        const state = await this.repository.load(slotId);
        assertSelected();
        if (!state) throw new Error("保存済みのゲームがありません");
        if (
          state.gameId !== selected.gameId ||
          state.slotId !== selected.slotId
        )
          throw new SelectionChanged();
        return state;
      },
      save: async (expected, state) => {
        assertSelected();
        if (
          state.gameId !== selected.gameId ||
          state.slotId !== selected.slotId
        )
          throw new SelectionChanged();
        await this.repository.save(
          expected,
          state,
          () =>
            this.generation === generation &&
            this.state?.gameId === selected.gameId,
        );
        assertSelected();
        // Publish every successful monthly commit, never an uncommitted draft.
        this.state = state;
        this.publish();
      },
      create: async () => {
        throw new Error("新規開始の前に現在のゲームを閉じてください");
      },
    };
    this.queued += 1;
    this.publish();
    const result = this.queue.then(async () => {
      try {
        assertSelected();
        const next = await operation(guarded, selected.slotId);
        assertSelected();
        this.state = next;
        return next;
      } catch (error) {
        if (error instanceof SelectionChanged || this.generation !== generation)
          return null;
        this.error =
          error instanceof Error ? error.message : "時間を進められませんでした";
        // The failing month is never retried automatically. Save the stop against
        // the last durable state; if storage itself failed, keep a local latch.
        if (this.state && isAutomaticRunning(this.state)) {
          let durable = this.state;
          try {
            durable = (await guarded.load(selected.slotId)) ?? durable;
            if (isAutomaticRunning(durable)) {
              const stopped = stopClock(
                { ...durable, runState: "paused" },
                "error",
              );
              try {
                await guarded.save(policyStateHash(durable), stopped);
              } catch (stopError) {
                if (stopError instanceof SelectionChanged) throw stopError;
                this.state = stopped;
              }
            } else this.state = durable;
          } catch (stopError) {
            if (
              stopError instanceof SelectionChanged ||
              this.generation !== generation
            )
              return null;
            this.state = stopClock({ ...durable, runState: "paused" }, "error");
          }
          this.errorStops.set(selected.gameId, this.error);
        }
        throw error;
      } finally {
        if (this.generation === generation) {
          this.queued -= 1;
          this.publish();
        }
      }
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Other state-changing services use the same queue and selection guards. */
  mutate(
    operation: (
      repository: GameRepository,
      slotId: GameState["slotId"],
    ) => Promise<GameState>,
  ): Promise<GameState | null> {
    return this.run(operation);
  }

  selectMode(mode: "manual" | "auto"): Promise<GameState | null> {
    return this.run(async (repository, slotId) => {
      const state = (await repository.load(slotId))!;
      if (state.clock.progressionMode === mode)
        return this.error ? (this.state ?? state) : state;
      const checkpoint = this.error
        ? state
        : checkpointClock(state, this.nowMs());
      const next = stopClock(
        {
          ...checkpoint,
          runState:
            state.runState === "running" || state.runState === "calculating"
              ? "paused"
              : state.runState,
          clock: { ...checkpoint.clock, progressionMode: mode },
        },
        state.runState === "awaitingEvent"
          ? "event"
          : state.runState === "crisisStopped"
            ? "crisis"
            : state.runState === "completed"
              ? "completed"
              : state.runState === "failed"
                ? "failed"
                : "manual",
      );
      await repository.save(policyStateHash(state), next);
      this.error = null;
      this.errorStops.delete(state.gameId);
      return next;
    });
  }

  start(): Promise<GameState | null> {
    return this.run(async (repository, slotId) => {
      const state = (await repository.load(slotId))!;
      if (state.clock.progressionMode !== "auto")
        throw new Error("自動モードを選んでから開始してください");
      if (isTutorialTime(state))
        throw new Error("説明を確認する期間は、1か月ずつ進めてください");
      if (
        state.runState !== "paused" &&
        !(state.runState === "running" && this.error)
      ) {
        if (state.runState === "running") return state;
        throw new Error("イベントや危機への対応を終えてから再開してください");
      }
      const clock = { ...state.clock };
      delete clock.stopReason;
      delete clock.warning;
      const next: GameState = {
        ...state,
        runState: "running",
        clock: { ...clock, lastProcessedWallClockMs: this.nowMs() },
      };
      await repository.save(policyStateHash(state), next);
      this.error = null;
      this.errorStops.delete(state.gameId);
      return next;
    });
  }

  pause(reason: ClockStopReason = "manual"): Promise<GameState | null> {
    return this.run(async (repository, slotId) => {
      const state = (await repository.load(slotId))!;
      if (state.runState !== "running" && state.runState !== "paused")
        return state;
      if (state.runState === "paused" && state.clock.stopReason === reason)
        return state;
      const checkpoint = this.error
        ? state
        : checkpointClock(state, this.nowMs());
      const next = stopClock({ ...checkpoint, runState: "paused" }, reason);
      await repository.save(policyStateHash(state), next);
      return next;
    });
  }

  manualStep(): Promise<GameState | null> {
    return this.run(async (repository, slotId) => {
      const state = (await repository.load(slotId))!;
      if (state.clock.progressionMode === "auto")
        throw new Error("手動モードに切り替えてから月を進めてください");
      const next = await advanceMonth(repository, slotId);
      this.error = null;
      this.errorStops.delete(state.gameId);
      return next;
    });
  }

  /** Hidden pages checkpoint the same budget without also executing a batch. */
  checkpoint(): Promise<GameState | null> {
    return this.run(async (repository, slotId) => {
      const state = (await repository.load(slotId))!;
      if (this.error || !isAutomaticRunning(state)) return this.state ?? state;
      if (isTutorialTime(state)) {
        const stopped = stopClock({ ...state, runState: "paused" }, "tutorial");
        await repository.save(policyStateHash(state), stopped);
        return stopped;
      }
      const next = checkpointClock(state, this.nowMs());
      if (policyStateHash(next) !== policyStateHash(state))
        await repository.save(policyStateHash(state), next);
      return next;
    });
  }

  synchronize(options: SynchronizeOptions = {}): Promise<GameState | null> {
    const generation = this.generation;
    return this.run(async (repository, slotId) => {
      const state = (await repository.load(slotId))!;
      if (this.error || !isAutomaticRunning(state)) return this.state ?? state;
      if (isTutorialTime(state)) {
        const stopped = stopClock({ ...state, runState: "paused" }, "tutorial");
        await repository.save(policyStateHash(state), stopped);
        return stopped;
      }
      const checkpoint = checkpointClock(state, this.nowMs());
      if (policyStateHash(checkpoint) !== policyStateHash(state)) {
        await repository.save(policyStateHash(state), checkpoint);
      }
      try {
        // The Worker computes one month; guarded save commits it before the next
        // request. Neither a cancelled selection nor a crash can save a draft.
        const compute = (state: GameState) => this.monthClient.calculate(state);
        return options.offline
          ? await catchUpOffline(
              repository,
              slotId,
              0,
              options.onProgress,
              compute,
            )
          : await processPendingSteps(
              repository,
              slotId,
              96,
              options.onProgress,
              compute,
            );
      } finally {
        if (this.generation === generation) this.monthClient.cancel();
      }
    });
  }
}
