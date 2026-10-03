import type { GameState } from "@macro-nation/domain";
import { policyStateHash } from "@macro-nation/simulation-engine";
import { describe, expect, it } from "vitest";
import { GameClockController, tutorialStepLimit } from "./game-clock";
import { advanceMonth, createGame, type GameRepository } from "./game-service";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function memory() {
  const slots = new Map<GameState["slotId"], GameState>();
  const saves: GameState[] = [];
  let beforeSave: ((state: GameState) => void | Promise<void>) | undefined;
  let nextLoad:
    | {
        entered: ReturnType<typeof deferred>;
        released: ReturnType<typeof deferred>;
      }
    | undefined;
  const repository: GameRepository = {
    async load(slotId) {
      const state = slots.get(slotId);
      const result = state ? structuredClone(state) : null;
      if (nextLoad) {
        const blocked = nextLoad;
        nextLoad = undefined;
        blocked.entered.resolve();
        await blocked.released.promise;
      }
      return result;
    },
    async create(state) {
      slots.set(state.slotId, structuredClone(state));
    },
    async save(expected, next, shouldCommit) {
      await beforeSave?.(next);
      if (shouldCommit?.() === false) throw new Error("save canceled");
      const current = slots.get(next.slotId);
      if (!current || policyStateHash(current) !== expected)
        throw new Error("stale save");
      slots.set(next.slotId, structuredClone(next));
      saves.push(structuredClone(next));
    },
  };
  return {
    repository,
    saves,
    replace(state: GameState) {
      slots.set(state.slotId, structuredClone(state));
    },
    saved(slotId: GameState["slotId"] = 1) {
      return slots.get(slotId)!;
    },
    setBeforeSave(callback?: (state: GameState) => void | Promise<void>) {
      beforeSave = callback;
    },
    blockNextLoad() {
      nextLoad = { entered: deferred(), released: deferred() };
      return nextLoad;
    },
  };
}

async function fixture(realSecondsPerStep = 300) {
  const storage = memory();
  const created = await createGame(
    storage.repository,
    "baseline-96",
    1,
    "standard",
    "long",
  );
  const initial: GameState = {
    ...created,
    clock: {
      ...created.clock,
      config: {
        ...created.clock.config,
        realSecondsPerStep,
        offlineMaxSteps: 96,
      },
    },
  };
  storage.replace(initial);
  let now = 1_000_000;
  const controller = new GameClockController(storage.repository, {
    nowMs: () => now,
  });
  controller.selectGame(initial);
  return {
    storage,
    initial,
    controller,
    advance(ms: number) {
      now += ms;
    },
    get now() {
      return now;
    },
  };
}

async function startAuto(controller: GameClockController) {
  await controller.selectMode("auto");
  return controller.start();
}

function simulationResult(state: GameState) {
  return {
    monthIndex: state.monthIndex,
    tickSequence: state.tickSequence,
    economy: state.economy,
    rng: state.rng,
    policies: state.policies,
    effects: state.effects,
    events: state.events,
    crisisCounters: state.crisisCounters,
    history: state.history,
  };
}

describe("GameClockController wall-clock progression", () => {
  it.each([3, 2])(
    "requires learning tutorial steps before starting automatic time with a %s-month policy cycle",
    async (policyCycleSteps) => {
      const f = await fixture();
      const learning: GameState = {
        ...f.initial,
        learningMode: "learning",
        clock: {
          ...f.initial.clock,
          config: { ...f.initial.clock.config, policyCycleSteps },
        },
      };
      f.storage.replace(learning);
      f.controller.selectGame(learning);
      const limit = 4 * policyCycleSteps;
      expect(tutorialStepLimit(learning)).toBe(limit);
      await f.controller.selectMode("auto");
      await expect(f.controller.start()).rejects.toThrow();
      expect(f.storage.saved().monthIndex).toBe(0);
      expect(f.storage.saved().runState).toBe("paused");
      await f.controller.selectMode("manual");
      for (let month = 0; month < limit - 1; month += 1)
        await f.controller.manualStep();
      await f.controller.selectMode("auto");
      await expect(f.controller.start()).rejects.toThrow();
      await f.controller.selectMode("manual");
      await f.controller.manualStep();
      await startAuto(f.controller);
      expect(f.storage.saved().monthIndex).toBe(limit);
      expect(f.storage.saved().runState).toBe("running");
      f.controller.dispose();
    },
  );

  it.each([false, true])(
    "stops manipulated running tutorial saves before elapsed accrual (offline=%s)",
    async (offline) => {
      const f = await fixture();
      const clock = { ...f.initial.clock };
      delete clock.stopReason;
      const running: GameState = {
        ...f.initial,
        learningMode: "learning",
        runState: "running",
        pendingOfflineSteps: 3,
        clock: {
          ...clock,
          progressionMode: "auto",
          lastProcessedWallClockMs: f.now,
          remainderMs: 123,
        },
      };
      f.storage.replace(running);
      f.controller.selectGame(running);
      f.advance(4 * 300_000);
      await f.controller.synchronize({ offline });
      expect(f.storage.saved().monthIndex).toBe(0);
      expect(f.storage.saved().pendingOfflineSteps).toBe(3);
      expect(f.storage.saved().clock.remainderMs).toBe(123);
      expect(f.storage.saved().runState).toBe("paused");
      expect(f.storage.saved().clock.stopReason).toBe("tutorial");
      expect(f.storage.saved().clock.lastProcessedWallClockMs).toBeNull();
      f.advance(4 * 300_000);
      await f.controller.synchronize({ offline });
      expect(f.storage.saved().pendingOfflineSteps).toBe(3);
      expect(f.storage.saved().monthIndex).toBe(0);
      f.controller.dispose();
    },
  );

  it("starts new games paused in manual mode and ignores elapsed time", async () => {
    const f = await fixture();
    expect(f.initial.versions.saveSchemaVersion).toBe("3");
    expect(f.initial.runState).toBe("paused");
    expect(f.initial.clock.progressionMode).toBe("manual");
    expect(f.initial.clock.lastProcessedWallClockMs).toBeNull();
    expect(f.initial.clock.remainderMs).toBe(0);
    f.advance(24 * 60 * 60 * 1_000);
    await f.controller.synchronize({ offline: true });
    expect(f.storage.saved().monthIndex).toBe(0);
    expect(f.storage.saved().pendingOfflineSteps).toBe(0);
    await f.controller.manualStep();
    expect(f.storage.saved().monthIndex).toBe(1);
    expect(f.storage.saved().runState).toBe("paused");
    expect(f.storage.saved().clock.lastProcessedWallClockMs).toBeNull();
    f.controller.dispose();
  });

  it("uses the saved ClockConfig and carries every fractional millisecond", async () => {
    const f = await fixture(7.5);
    await startAuto(f.controller);
    f.advance(7_499);
    await f.controller.synchronize();
    expect(f.storage.saved().monthIndex).toBe(0);
    expect(f.storage.saved().clock.remainderMs).toBe(7_499);
    expect(f.controller.snapshot.remainingMs).toBe(1);
    f.advance(1);
    await f.controller.synchronize();
    expect(f.storage.saved().monthIndex).toBe(1);
    expect(f.storage.saved().clock.remainderMs).toBe(0);
    expect(f.controller.snapshot.remainingMs).toBe(7_500);
    f.advance(15_001);
    await f.controller.synchronize();
    expect(f.storage.saved().monthIndex).toBe(3);
    expect(f.storage.saved().clock.remainderMs).toBe(1);
    expect(f.storage.saved().clock.lastProcessedWallClockMs).toBe(f.now);
    expect(f.storage.saved().runState).toBe("running");
    f.controller.dispose();
  });

  it("makes an offline return identical to one foreground callback per month", async () => {
    const sequential = await fixture();
    const delayed = await fixture();
    await startAuto(sequential.controller);
    await startAuto(delayed.controller);
    for (let month = 0; month < 12; month += 1) {
      sequential.advance(300_000);
      await sequential.controller.synchronize();
    }
    delayed.advance(12 * 300_000 + 123);
    await delayed.controller.synchronize({ offline: true });
    sequential.advance(123);
    await sequential.controller.synchronize();
    expect(delayed.storage.saved()).toEqual(sequential.storage.saved());
    expect(delayed.storage.saved().history.reports).toHaveLength(13);
    sequential.controller.dispose();
    delayed.controller.dispose();
  });

  it("matches manual Engine results after the same number of elapsed months", async () => {
    const automatic = await fixture();
    const manual = memory();
    manual.replace(automatic.initial);
    await startAuto(automatic.controller);
    automatic.advance(12 * 300_000);
    await automatic.controller.synchronize({ offline: true });
    let stepped = automatic.initial;
    for (let month = 0; month < 12; month += 1)
      stepped = await advanceMonth(manual.repository, 1);
    expect(simulationResult(automatic.storage.saved())).toEqual(
      simulationResult(stepped),
    );
    automatic.controller.dispose();
  });

  it("preserves pending months and the fraction on policy pause, excluding stopped time", async () => {
    const f = await fixture();
    await startAuto(f.controller);
    f.advance(2 * 300_000 + 125_000);
    await f.controller.pause("policy");
    expect(f.storage.saved().monthIndex).toBe(0);
    expect(f.storage.saved().pendingOfflineSteps).toBe(2);
    expect(f.storage.saved().clock.remainderMs).toBe(125_000);
    expect(f.storage.saved().clock.lastProcessedWallClockMs).toBeNull();
    expect(f.storage.saved().clock.stopReason).toBe("policy");
    f.advance(12 * 300_000);
    await f.controller.synchronize({ offline: true });
    expect(f.storage.saved().monthIndex).toBe(0);
    expect(f.storage.saved().pendingOfflineSteps).toBe(2);
    await f.controller.start();
    await f.controller.synchronize();
    expect(f.storage.saved().monthIndex).toBe(2);
    expect(f.storage.saved().clock.remainderMs).toBe(125_000);
    f.advance(174_999);
    await f.controller.synchronize();
    expect(f.storage.saved().monthIndex).toBe(2);
    f.advance(1);
    await f.controller.synchronize();
    expect(f.storage.saved().monthIndex).toBe(3);
    f.controller.dispose();
  });

  it("persists mode changes while requiring an explicit start to resume automatic time", async () => {
    const f = await fixture();
    await startAuto(f.controller);
    f.advance(125_000);
    await f.controller.selectMode("manual");
    expect(f.storage.saved().runState).toBe("paused");
    expect(f.storage.saved().clock.progressionMode).toBe("manual");
    expect(f.storage.saved().clock.remainderMs).toBe(125_000);
    await f.controller.manualStep();
    f.advance(10 * 300_000);
    await f.controller.selectMode("auto");
    await f.controller.synchronize({ offline: true });
    expect(f.storage.saved().monthIndex).toBe(1);
    expect(f.storage.saved().runState).toBe("paused");
    expect(f.storage.saved().clock.progressionMode).toBe("auto");
    expect(f.storage.saved().clock.lastProcessedWallClockMs).toBeNull();
    await f.controller.start();
    f.advance(175_000);
    await f.controller.synchronize();
    expect(f.storage.saved().monthIndex).toBe(2);
    expect(f.storage.saved().clock.remainderMs).toBe(0);
    f.controller.dispose();
  });

  it("checkpoints elapsed time without ticking and continues exactly once after reload", async () => {
    const f = await fixture();
    await startAuto(f.controller);
    f.advance(2 * 300_000 + 31_000);
    await f.controller.checkpoint();
    expect(f.storage.saved().monthIndex).toBe(0);
    expect(f.storage.saved().pendingOfflineSteps).toBe(2);
    expect(f.storage.saved().clock.remainderMs).toBe(31_000);
    expect(f.storage.saved().runState).toBe("running");
    f.controller.dispose();
    f.advance(300_000);
    const restored = new GameClockController(f.storage.repository, {
      nowMs: () => f.now,
    });
    restored.selectGame(f.storage.saved());
    await restored.synchronize({ offline: true });
    expect(f.storage.saved().monthIndex).toBe(3);
    expect(f.storage.saved().pendingOfflineSteps).toBe(0);
    expect(f.storage.saved().clock.remainderMs).toBe(31_000);
    await restored.synchronize({ offline: true });
    expect(f.storage.saved().monthIndex).toBe(3);
    restored.dispose();
  });

  it("treats a backward wall clock as zero elapsed without gaining months", async () => {
    const f = await fixture();
    await startAuto(f.controller);
    f.advance(100_000);
    await f.controller.synchronize();
    const before = f.storage.saved();
    f.advance(-50_000);
    await f.controller.synchronize();
    expect(f.storage.saved().monthIndex).toBe(0);
    expect(f.storage.saved().clock.remainderMs).toBe(100_000);
    expect(
      f.storage.saved().clock.lastProcessedWallClockMs,
    ).toBeGreaterThanOrEqual(before.clock.lastProcessedWallClockMs!);
    f.advance(250_000);
    await f.controller.synchronize();
    expect(f.storage.saved().monthIndex).toBe(1);
    expect(f.storage.saved().clock.remainderMs).toBe(0);
    f.controller.dispose();
  });

  it("keeps excess offline months until an explicit resume after the 96-month limit", async () => {
    const f = await fixture();
    await startAuto(f.controller);
    f.advance(100 * 300_000 + 17);
    const progress: number[] = [];
    await f.controller.synchronize({
      offline: true,
      onProgress: (completed) => {
        progress.push(completed);
      },
    });
    expect(f.storage.saved().monthIndex).toBe(96);
    expect(f.storage.saved().pendingOfflineSteps).toBe(4);
    expect(f.storage.saved().clock.remainderMs).toBe(17);
    expect(f.storage.saved().runState).toBe("paused");
    expect(f.storage.saved().clock.stopReason).toBe("offlineLimit");
    expect(f.storage.saved().clock.lastProcessedWallClockMs).toBeNull();
    expect(progress.at(-1)).toBe(96);
    await f.controller.synchronize({ offline: true });
    expect(f.storage.saved().monthIndex).toBe(96);
    f.advance(50 * 300_000);
    await f.controller.start();
    await f.controller.synchronize();
    expect(f.storage.saved().monthIndex).toBe(100);
    expect(f.storage.saved().pendingOfflineSteps).toBe(0);
    expect(f.storage.saved().clock.remainderMs).toBe(17);
    expect(f.storage.saved().runState).toBe("running");
    f.controller.dispose();
  }, 15_000);

  it("honors a smaller configured offline processing limit", async () => {
    const f = await fixture();
    const limited: GameState = {
      ...f.initial,
      clock: {
        ...f.initial.clock,
        config: { ...f.initial.clock.config, offlineMaxSteps: 2 },
      },
    };
    f.storage.replace(limited);
    f.controller.selectGame(limited);
    await startAuto(f.controller);
    f.advance(5 * 300_000);
    await f.controller.synchronize({ offline: true });
    expect(f.storage.saved().monthIndex).toBe(2);
    expect(f.storage.saved().pendingOfflineSteps).toBe(3);
    expect(f.storage.saved().clock.stopReason).toBe("offlineLimit");
    await f.controller.start();
    await f.controller.synchronize({ offline: true });
    expect(f.storage.saved().monthIndex).toBe(4);
    expect(f.storage.saved().pendingOfflineSteps).toBe(1);
    await f.controller.start();
    await f.controller.synchronize({ offline: true });
    expect(f.storage.saved().monthIndex).toBe(5);
    expect(f.storage.saved().pendingOfflineSteps).toBe(0);
    expect(f.storage.saved().runState).toBe("running");
    f.controller.dispose();
  });

  it.each(["awaitingEvent", "crisisStopped", "completed", "failed"] as const)(
    "does not accrue time or restart a %s game",
    async (runState) => {
      const f = await fixture();
      const blocked: GameState = {
        ...f.initial,
        runState,
        pendingOfflineSteps: 5,
        clock: {
          ...f.initial.clock,
          progressionMode: "auto",
          lastProcessedWallClockMs: null,
          remainderMs: 123,
        },
      };
      f.storage.replace(blocked);
      f.controller.selectGame(blocked);
      f.advance(10 * 300_000);
      await f.controller.synchronize({ offline: true });
      await expect(f.controller.start()).rejects.toThrow();
      expect(f.storage.saved()).toEqual(blocked);
      expect(f.controller.snapshot.state?.runState).toBe(runState);
      f.controller.dispose();
    },
  );

  it("stops at completion and retains unprocessed elapsed months", async () => {
    const f = await fixture();
    const nearlyFinished: GameState = {
      ...f.initial,
      clock: { ...f.initial.clock, endMonth: 2, durationMode: "custom" },
      durationMode: "custom",
    };
    f.storage.replace(nearlyFinished);
    f.controller.selectGame(nearlyFinished);
    await startAuto(f.controller);
    f.advance(4 * 300_000);
    await f.controller.synchronize();
    expect(f.storage.saved().monthIndex).toBe(2);
    expect(f.storage.saved().runState).toBe("completed");
    expect(f.storage.saved().pendingOfflineSteps).toBe(2);
    expect(f.storage.saved().clock.stopReason).toBe("completed");
    expect(f.storage.saved().clock.lastProcessedWallClockMs).toBeNull();
    f.advance(4 * 300_000);
    await f.controller.synchronize();
    expect(f.storage.saved().monthIndex).toBe(2);
    expect(f.storage.saved().pendingOfflineSteps).toBe(2);
    f.controller.dispose();
  });
});

describe("GameClockController serialization and failure safety", () => {
  it("publishes busy and committed results while holding unsaved monthly drafts", async () => {
    const f = await fixture();
    await startAuto(f.controller);
    const entered = deferred();
    const released = deferred();
    f.storage.setBeforeSave(async (next) => {
      if (next.monthIndex === 1) {
        entered.resolve();
        await released.promise;
      }
    });
    const seen: number[] = [];
    const unsubscribe = f.controller.subscribe(() => {
      seen.push(f.controller.snapshot.state!.monthIndex);
    });
    f.advance(300_000);
    const ticking = f.controller.synchronize();
    await entered.promise;
    expect(f.controller.snapshot.busy).toBe(true);
    expect(f.controller.snapshot.state?.monthIndex).toBe(0);
    expect(seen.every((month) => month === 0)).toBe(true);
    released.resolve();
    await ticking;
    expect(f.controller.snapshot.busy).toBe(false);
    expect(f.controller.snapshot.state?.monthIndex).toBe(1);
    expect(seen).toContain(1);
    unsubscribe();
    const published = seen.length;
    f.advance(300_000);
    await f.controller.synchronize();
    expect(seen).toHaveLength(published);
    f.controller.dispose();
  });

  it("serializes queued manual steps and state mutations with durable results", async () => {
    const f = await fixture();
    const results = await Promise.all([
      f.controller.manualStep(),
      f.controller.mutate(async (repository, slotId) => {
        const state = (await repository.load(slotId))!;
        const next: GameState = { ...state, learningMode: "casual" };
        await repository.save(policyStateHash(state), next);
        return next;
      }),
      f.controller.manualStep(),
      f.controller.manualStep(),
    ]);
    expect(results.map((state) => state?.monthIndex)).toEqual([1, 1, 2, 3]);
    expect(f.storage.saved().monthIndex).toBe(3);
    expect(f.storage.saved().learningMode).toBe("casual");
    expect(f.storage.saved().history.reports).toHaveLength(4);
    expect(f.controller.snapshot.state).toEqual(f.storage.saved());
    expect(f.controller.snapshot.busy).toBe(false);
    f.controller.dispose();
  });

  it("does not double-count elapsed time across simultaneous callbacks", async () => {
    const f = await fixture();
    await startAuto(f.controller);
    f.advance(3 * 300_000 + 29);
    await Promise.all([
      f.controller.synchronize(),
      f.controller.synchronize(),
      f.controller.synchronize(),
    ]);
    expect(f.storage.saved().monthIndex).toBe(3);
    expect(f.storage.saved().clock.remainderMs).toBe(29);
    expect(f.storage.saved().history.reports).toHaveLength(4);
    f.controller.dispose();
  });

  it("cancels a slow old-slot load before saving or replacing the selected game", async () => {
    const f = await fixture();
    const second = await createGame(f.storage.repository, "second-slot", 2);
    const load = f.storage.blockNextLoad();
    const stale = f.controller.manualStep();
    await load.entered.promise;
    f.controller.selectGame(second);
    load.released.resolve();
    expect(await stale).toBeNull();
    expect(f.storage.saved(1).monthIndex).toBe(0);
    expect(f.storage.saved(2).monthIndex).toBe(0);
    expect(f.controller.snapshot.state).toEqual(second);
    expect(f.controller.snapshot.busy).toBe(false);
    await f.controller.manualStep();
    expect(f.storage.saved(1).monthIndex).toBe(0);
    expect(f.storage.saved(2).monthIndex).toBe(1);
    f.controller.dispose();
  });

  it("invalidates writes when a slot is replaced by a different game", async () => {
    const f = await fixture();
    const replacement: GameState = {
      ...f.initial,
      gameId: "replacement-game",
    };
    const load = f.storage.blockNextLoad();
    const stale = f.controller.manualStep();
    await load.entered.promise;
    f.storage.replace(replacement);
    f.controller.selectGame(replacement);
    load.released.resolve();
    expect(await stale).toBeNull();
    expect(f.storage.saved()).toEqual(replacement);
    expect(f.controller.snapshot.state).toEqual(replacement);
    f.controller.dispose();
  });

  it("rejects a loaded save whose game identity changed outside the selected session", async () => {
    const f = await fixture();
    const replacement: GameState = {
      ...f.initial,
      gameId: "replacement-game",
    };
    f.storage.replace(replacement);
    expect(await f.controller.manualStep()).toBeNull();
    expect(f.storage.saved()).toEqual(replacement);
    expect(f.controller.snapshot.error).toBeNull();
    f.controller.dispose();
  });

  it("cancels an old-slot save that was waiting for its transaction to commit", async () => {
    const f = await fixture();
    const second = await createGame(f.storage.repository, "second-slot", 2);
    const entered = deferred();
    const released = deferred();
    f.storage.setBeforeSave(async (next) => {
      if (next.slotId === 1 && next.monthIndex === 1) {
        entered.resolve();
        await released.promise;
      }
    });
    const stale = f.controller.manualStep();
    await entered.promise;
    f.controller.selectGame(second);
    released.resolve();
    expect(await stale).toBeNull();
    expect(f.storage.saved(1)).toEqual(f.initial);
    expect(f.storage.saved(2)).toEqual(second);
    expect(f.controller.snapshot.state).toEqual(second);
    f.controller.dispose();
  });

  it("pauses after a failed monthly save and never retries that month automatically", async () => {
    const f = await fixture();
    await startAuto(f.controller);
    let monthSaveAttempts = 0;
    f.storage.setBeforeSave((next) => {
      if (next.monthIndex > f.storage.saved().monthIndex) {
        monthSaveAttempts += 1;
        throw new Error("save interrupted");
      }
    });
    f.advance(300_000);
    await expect(f.controller.synchronize()).rejects.toThrow(
      "save interrupted",
    );
    expect(monthSaveAttempts).toBe(1);
    expect(f.storage.saved().monthIndex).toBe(0);
    expect(f.storage.saved().runState).toBe("paused");
    expect(f.storage.saved().pendingOfflineSteps).toBe(1);
    expect(f.storage.saved().clock.stopReason).toBe("error");
    expect(f.storage.saved().clock.lastProcessedWallClockMs).toBeNull();
    expect(f.controller.snapshot.error).toBeTruthy();
    f.advance(3 * 300_000);
    await f.controller.synchronize();
    expect(monthSaveAttempts).toBe(1);
    expect(f.storage.saved().monthIndex).toBe(0);
    expect(f.controller.snapshot.busy).toBe(false);
    f.storage.setBeforeSave();
    await f.controller.start();
    await f.controller.synchronize();
    expect(f.storage.saved().monthIndex).toBe(1);
    expect(f.storage.saved().pendingOfflineSteps).toBe(0);
    expect(f.controller.snapshot.error).toBeNull();
    f.controller.dispose();
  });

  it("retains the last durable simulation state after calculation failure", async () => {
    const f = await fixture();
    const invalid: GameState = {
      ...f.initial,
      economy: {
        ...f.initial.economy,
        sentiment: {
          ...f.initial.economy.sentiment,
          support: Number.NaN as GameState["economy"]["sentiment"]["support"],
        },
      },
    };
    f.storage.replace(invalid);
    f.controller.selectGame(invalid);
    await startAuto(f.controller);
    f.advance(300_000);
    await expect(f.controller.synchronize()).rejects.toThrow();
    expect(f.storage.saved().monthIndex).toBe(0);
    expect(f.storage.saved().economy).toEqual(invalid.economy);
    expect(f.storage.saved().rng).toEqual(invalid.rng);
    expect(f.storage.saved().history).toEqual(invalid.history);
    expect(f.storage.saved().runState).toBe("paused");
    expect(f.storage.saved().clock.stopReason).toBe("error");
    const writesAfterFailure = f.storage.saves.length;
    f.advance(300_000);
    await f.controller.synchronize();
    expect(f.storage.saves).toHaveLength(writesAfterFailure);
    f.controller.dispose();
  });

  it("keeps a local pause latch when even the error stop cannot be saved", async () => {
    const f = await fixture();
    await startAuto(f.controller);
    let writes = 0;
    f.storage.setBeforeSave(() => {
      writes += 1;
      throw new Error("storage unavailable");
    });
    f.advance(300_000);
    await expect(f.controller.synchronize()).rejects.toThrow(
      "storage unavailable",
    );
    expect(f.storage.saved().monthIndex).toBe(0);
    expect(f.controller.snapshot.state?.runState).toBe("paused");
    expect(f.controller.snapshot.state?.clock.stopReason).toBe("error");
    expect(
      f.controller.snapshot.state?.clock.lastProcessedWallClockMs,
    ).toBeNull();
    const failedWrites = writes;
    f.advance(300_000);
    await f.controller.synchronize();
    expect(writes).toBe(failedWrites);
    expect(f.controller.snapshot.state?.monthIndex).toBe(0);
    expect(f.controller.snapshot.error).toBeTruthy();
    f.controller.dispose();
  });

  it("preserves the local error stop when reselecting the current mode", async () => {
    const f = await fixture();
    await startAuto(f.controller);
    f.storage.setBeforeSave(() => {
      throw new Error("storage unavailable");
    });
    f.advance(300_000);
    await expect(f.controller.synchronize()).rejects.toThrow(
      "storage unavailable",
    );
    f.advance(2 * 300_000);
    await f.controller.selectMode("auto");
    expect(f.controller.snapshot.state?.runState).toBe("paused");
    expect(
      f.controller.snapshot.state?.clock.lastProcessedWallClockMs,
    ).toBeNull();
    expect(f.controller.snapshot.state?.clock.stopReason).toBe("error");
    expect(f.controller.snapshot.error).toBeTruthy();
    f.controller.dispose();
  });

  it("does not accrue time stopped by an unsaved error when opening policy", async () => {
    const f = await fixture();
    await startAuto(f.controller);
    f.storage.setBeforeSave(() => {
      throw new Error("storage unavailable");
    });
    f.advance(300_000);
    await expect(f.controller.synchronize()).rejects.toThrow(
      "storage unavailable",
    );
    f.advance(2 * 300_000);
    f.storage.setBeforeSave();
    await f.controller.pause("policy");
    expect(f.storage.saved().runState).toBe("paused");
    expect(f.storage.saved().pendingOfflineSteps).toBe(0);
    expect(f.storage.saved().clock.remainderMs).toBe(0);
    expect(f.storage.saved().clock.lastProcessedWallClockMs).toBeNull();
    f.controller.dispose();
  });
});
