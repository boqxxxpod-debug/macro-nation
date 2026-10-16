import { afterEach, describe, expect, it, vi } from "vitest";
import { scorePoint, type CausalContribution, type GameState } from "@macro-nation/domain";
import {
  policyStateHash,
  previewPolicy,
  runPolicyHeadless,
} from "@macro-nation/simulation-engine";
import {
  advanceMonth,
  calculateMonth,
  catchUpOffline,
  confirmPolicy,
  createGame,
  evaluateEnding,
  resolveEvent,
  reportSnapshot,
  resumeCrisis,
  type GameRepository,
} from "./game-service";

afterEach(() => {
  vi.restoreAllMocks();
});

// These integration budgets include cloning and hashing every historical
// causal term at each durable step, rather than only the compact summaries.
const YEAR_RUN_TIMEOUT_MS = 15_000;
const FOUR_YEAR_RUN_TIMEOUT_MS = 60_000;
const OFFLINE_LIMIT_RUN_TIMEOUT_MS = 120_000;

function memory() {
  let saved: GameState | null = null;
  const repository: GameRepository = {
    async load() {
      return saved ? structuredClone(saved) : null;
    },
    async create(state) {
      saved = structuredClone(state);
    },
    async save(expected, next) {
      if (!saved || policyStateHash(saved) !== expected)
        throw new Error("stale save");
      saved = structuredClone(next);
    },
  };
  return {
    repository,
    replace(state: GameState) {
      saved = structuredClone(state);
    },
    get saved() {
      return saved;
    },
  };
}

describe("SCN-01 first playable", () => {
  it("preserves every indicator and term in each monthly Engine trace through a save and reload", async () => {
    const storage = memory();
    const initial = await createGame(storage.repository, "complete-causal-trace", 1, "standard");
    const first = await advanceMonth(storage.repository, 1);
    const second = await advanceMonth(storage.repository, 1);
    for (const [before, after] of [[initial, first], [first, second]] as const) {
      const engine = runPolicyHeadless({
        initialState: { ...before, runState: "running" },
        tickCount: 1,
        deriveReactions: true,
      });
      const trace = after.history.reports!.at(-1)!.causalTrace!;
      expect(trace.completeness).toBe("complete");
      expect(trace.indicators).toEqual(engine.records[0]!.diagnostics.causal);
      expect(trace.indicators.map((item) => item.indicatorId))
        .toEqual(expect.arrayContaining(["realGdp", "inflation", "unemployment"]));
      expect(trace.indicators.reduce((sum, item) => sum + item.contributions.length, 0))
        .toBeGreaterThan(8);
      expect(after.economy).toEqual(engine.finalState.economy);
      expect(after.rng).toEqual(engine.finalState.rng);
    }
    expect(second.history.reports?.[1]).toEqual(first.history.reports?.[1]);
    const reloaded = await storage.repository.load(1);
    expect(reloaded?.history.reports).toEqual(second.history.reports);
    const serialized = JSON.parse(JSON.stringify(second)) as GameState;
    // JSON represents -0 as 0; retain the exact raw Engine/IDB checks above.
    expect(JSON.stringify(serialized.history.reports)).toBe(JSON.stringify(second.history.reports));
  });

  it("retains stage order, duplicate indicators, zero terms, effect references, and diagnostics", async () => {
    const storage = memory();
    const state = await createGame(storage.repository, "causal-stage-order");
    const first: CausalContribution = {
      indicatorId: "inflation", beforeValue: 0.02, afterValue: 0.03, totalDelta: 0.01,
      contributions: [
        { sourceType: "policy", sourceId: "rate", effectId: "effect-rate", labelKey: "policy.rate", confidence: "medium", delta: 0.01 },
        { sourceType: "random", sourceId: "zero", labelKey: "random.zero", confidence: "low", delta: 0 },
      ],
      diagnostics: [{ kind: "rounding", internalValue: 0.03, displayValue: 0, displayDelta: -0.03 }],
    };
    const second: CausalContribution = {
      ...first, beforeValue: 0.03, afterValue: 0.02, totalDelta: -0.01,
      contributions: [{ ...first.contributions[0]!, delta: -0.01 }],
      diagnostics: [{ kind: "clamp", rawValue: 0.03, adjustedValue: 0.02, delta: -0.01, max: 0.02 }],
    };
    const trace = [first, second];
    const report = reportSnapshot(state, trace);
    expect(report.causalTrace).toEqual({ completeness: "complete", indicators: trace });
    expect(report.causalTrace?.indicators).not.toBe(trace);
    expect(report.causalTrace?.indicators[0]).not.toBe(first);
    expect(report.topCauses).toHaveLength(3);
  });

  it("preserves full-archive Engine results and the initial review baseline from month 59 to 60", async () => {
    const storage = memory();
    const initial = await createGame(storage.repository, "baseline-96", 1, "standard", "long");
    const initialReport = initial.history.reports![0]!;
    const baseline = {
      ...initialReport,
      values: { ...initialReport.values, realGdp: 70, realHouseholdIncome: 80 },
    };
    const prepared = runPolicyHeadless({
      initialState: { ...initial, runState: "running", history: { ...initial.history, reports: [baseline] } },
      tickCount: 59,
      deriveReactions: true,
    });
    expect(prepared.failure).toBeNull();
    expect(prepared.finalState.monthIndex).toBe(59);
    const archives = [baseline, ...prepared.records.map((record) =>
      reportSnapshot(record.state, record.diagnostics.causal, record.diagnostics.reactions),
    )];
    const before: GameState = {
      ...prepared.finalState,
      runState: "paused",
      history: { ...prepared.finalState.history, reports: archives },
    };
    const original = structuredClone(before);
    const fullArchiveEngine = runPolicyHeadless({
      initialState: { ...before, runState: "running" },
      tickCount: 1,
      deriveReactions: true,
    });
    expect(fullArchiveEngine.failure).toBeNull();
    const calculated = calculateMonth(before);
    expect(calculated.monthIndex).toBe(60);
    expect(calculated.economy).toEqual(fullArchiveEngine.finalState.economy);
    expect(calculated.rng).toEqual(fullArchiveEngine.finalState.rng);
    expect(calculated.policies).toEqual(fullArchiveEngine.finalState.policies);
    expect(calculated.effects).toEqual(fullArchiveEngine.finalState.effects);
    expect(calculated.events).toEqual(fullArchiveEngine.finalState.events);
    expect(calculated.longTerm).toEqual(fullArchiveEngine.finalState.longTerm);
    expect(calculated.history.reports!.at(-1)!.causalTrace!.indicators)
      .toEqual(fullArchiveEngine.records[0]!.diagnostics.causal);
    expect(calculated.history.reports!.at(-1)!.reactions)
      .toEqual(fullArchiveEngine.records[0]!.diagnostics.reactions);
    expect(calculated.history.reviews).toEqual(fullArchiveEngine.finalState.history.reviews);
    expect(calculated.history.reviews!.at(-1)!.monthIndex).toBe(60);
    expect(calculated.history.lastReviewMonth).toBe(60);
    expect(calculated.history.appliedMilestones).toEqual(fullArchiveEngine.finalState.history.appliedMilestones);
    expect(calculated.history.reports!.slice(0, -1)).toEqual(archives);
    expect(calculated.history.reports![0]).toBe(baseline);
    expect(calculated.history.reports![59]).toBe(archives[59]);
    expect(before).toEqual(original);
    storage.replace(before);
    await storage.repository.save(policyStateHash(before), calculated);
    expect(storage.saved!.history.reports!.slice(0, -1)).toEqual(archives);
  }, YEAR_RUN_TIMEOUT_MS);

  it("finishes at the final month even if a recoverable crisis occurs, while preserving terminal failure", async () => {
    for (const priorCritical of [0, 100]) {
      const storage = memory();
      const initial = await createGame(
        storage.repository,
        "final-crisis",
        1,
        "casual",
      );
      storage.replace({
        ...initial,
        durationMode: "custom",
        clock: { ...initial.clock, endMonth: 1, durationMode: "custom" },
        crisisCounters: { unresolved: priorCritical },
        economy: {
          ...initial.economy,
          sentiment: { ...initial.economy.sentiment, support: scorePoint(0) },
        },
      });
      const result = await advanceMonth(storage.repository, 1);
      expect(result.monthIndex).toBe(1);
      expect(result.runState).toBe(
        priorCritical === 0 ? "completed" : "failed",
      );
      expect(result.clock.stopReason).toBe(result.runState);
      await expect(advanceMonth(storage.repository, 1)).rejects.toThrow();
      expect(storage.saved?.monthIndex).toBe(1);
    }
  });
  it("does not spend already earned offline steps while paused or waiting for an event", async () => {
    const storage = memory();
    const initial = await createGame(
      storage.repository,
      "offline-stopped-budget",
    );
    for (const runState of [
      "paused",
      "awaitingEvent",
      "crisisStopped",
      "completed",
      "failed",
    ] as const) {
      const stopped: GameState = {
        ...initial,
        runState,
        pendingOfflineSteps: 5,
        clock: { ...initial.clock, progressionMode: "auto", remainderMs: 123 },
      };
      storage.replace(stopped);
      expect(await catchUpOffline(storage.repository, 1, 10 * 300)).toEqual(
        stopped,
      );
    }
    storage.replace({ ...initial, runState: "awaitingEvent" });
    await expect(advanceMonth(storage.repository, 1)).rejects.toThrow(
      /イベント/,
    );
  });

  it("rejects policy confirmation while the automatic clock is running", async () => {
    const storage = memory();
    const initial = await createGame(storage.repository, "policy-auto-guard");
    const running: GameState = {
      ...initial,
      runState: "running",
      clock: {
        ...initial.clock,
        progressionMode: "auto",
        lastProcessedWallClockMs: 1_000,
      },
    };
    storage.replace(running);
    const preview = previewPolicy({
      state: running,
      draft: {
        status: "draft",
        policyId: "rate",
        ruleId: "interest-rate",
        value: 0.05,
        quartersAhead: 0,
      },
      horizonMonths: 12,
    });
    await expect(
      confirmPolicy(storage.repository, 1, {
        kind: "commit",
        commandId: "running-policy",
        expectedStateHash: preview.stateHash,
        draft: preview.previewedDraft!,
      }),
    ).rejects.toThrow(/時間を止め/);
    expect(await storage.repository.load(1)).toEqual(running);
  });
  it("keeps Engine outcomes identical across all three explanation modes", async () => {
    const outcomes = [];
    for (const mode of ["casual", "standard", "learning"] as const) {
      const storage = memory();
      await createGame(storage.repository, "mode-invariance", 1, mode);
      const advanced = await advanceMonth(storage.repository, 1);
      outcomes.push({ economy: advanced.economy, rng: advanced.rng });
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
  });

  it("keeps the chosen duration through a save and defers offline steps beyond 96", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const storage = memory();
    const initial = await createGame(
      storage.repository,
      "baseline-96",
      1,
      "standard",
      "long",
    );
    expect(initial.clock.endMonth).toBe(240);
    storage.replace({
      ...initial,
      runState: "running",
      clock: { ...initial.clock, progressionMode: "auto" },
    });
    const progress: number[] = [];
    const first = await catchUpOffline(
      storage.repository,
      1,
      100 * 300,
      (completed) => {
        progress.push(completed);
      },
    );
    expect(first.monthIndex).toBe(96);
    expect(first.pendingOfflineSteps).toBe(4);
    expect(progress).toEqual(
      Array.from({ length: 24 }, (_, index) => (index + 1) * 4),
    );
    storage.replace({ ...first, runState: "running" });
    const resumed = await catchUpOffline(storage.repository, 1, 0);
    expect(resumed.monthIndex).toBe(100);
    expect(resumed.pendingOfflineSteps).toBe(0);
    expect(resumed.clock.endMonth).toBe(240);
    expect(
      (await storage.repository.load(1))?.history.reviews?.map(
        (item) => item.monthIndex,
      ),
    ).toEqual([60]);
  }, OFFLINE_LIMIT_RUN_TIMEOUT_MS);

  it("reports elapsed-time progress after each durable month when calculations take 250 milliseconds", async () => {
    let nowMs = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    const storage = memory();
    const initial = await createGame(
      storage.repository,
      "baseline-96",
      1,
      "standard",
      "long",
    );
    storage.replace({
      ...initial,
      runState: "running",
      clock: { ...initial.clock, progressionMode: "auto" },
    });
    const progress: { completed: number; pending: number }[] = [];
    let calculated: GameState | undefined;
    const result = await catchUpOffline(
      storage.repository,
      1,
      3 * initial.clock.config.realSecondsPerStep,
      (completed, pending) => {
        expect(storage.saved).toEqual(calculated);
        expect(storage.saved?.monthIndex).toBe(completed);
        expect(storage.saved?.pendingOfflineSteps).toBe(pending);
        progress.push({ completed, pending });
      },
      (state, fromOffline) => {
        calculated = calculateMonth(state, fromOffline);
        nowMs += 250;
        return calculated;
      },
    );
    expect(progress).toEqual([
      { completed: 1, pending: 2 },
      { completed: 2, pending: 1 },
      { completed: 3, pending: 0 },
    ]);
    expect(result.monthIndex).toBe(3);
    expect(result).toEqual(storage.saved);
  });

  it("does not accumulate offline time while paused", async () => {
    const storage = memory();
    await createGame(storage.repository, "paused-offline");
    const state = await catchUpOffline(storage.repository, 1, 100 * 300);
    expect(state.monthIndex).toBe(0);
    expect(state.pendingOfflineSteps).toBe(0);
  });
  it("finishes 48 sequential no-op months identically to one normal Engine batch", async () => {
    const storage = memory();
    const initial = await createGame(storage.repository, "first-playable-48");
    const batch = runPolicyHeadless({
      initialState: { ...initial, runState: "running" },
      tickCount: 48,
    });
    expect(batch.failure).toBeNull();
    let last = initial;
    for (let month = 0; month < 48; month += 1)
      last = await advanceMonth(storage.repository, 1);
    expect(last.monthIndex).toBe(48);
    expect(last.runState).toBe("completed");
    expect(last.economy).toEqual(batch.finalState.economy);
    expect(last.rng).toEqual(batch.finalState.rng);
    expect(last.history.reports).toHaveLength(49);
    expect(evaluateEnding(last).rank).not.toBe("F");
    await expect(advanceMonth(storage.repository, 1)).rejects.toThrow(/終了/);
  }, FOUR_YEAR_RUN_TIMEOUT_MS);

  it("persists the same 48-month save after four offline hours as sequential progress", async () => {
    const sequentialStorage = memory();
    const offlineStorage = memory();
    const sequentialInitial = await createGame(
      sequentialStorage.repository,
      "first-playable-offline-equivalence",
      1,
      "standard",
    );
    const offlineInitial = await createGame(
      offlineStorage.repository,
      "first-playable-offline-equivalence",
      1,
      "standard",
    );

    let sequential = sequentialInitial;
    for (let month = 0; month < 48; month += 1)
      sequential = await advanceMonth(sequentialStorage.repository, 1);

    offlineStorage.replace({
      ...offlineInitial,
      runState: "running",
      clock: { ...offlineInitial.clock, progressionMode: "auto" },
    });
    const offline = await catchUpOffline(
      offlineStorage.repository,
      1,
      4 * 60 * 60,
    );

    expect(offline.economy).toEqual(sequential.economy);
    expect(offline.rng).toEqual(sequential.rng);
    expect(offline.history).toEqual(sequential.history);
    expect(offline.runState).toBe(sequential.runState);
    expect(offline.history.reports).toHaveLength(49);
    expect(
      offline.history.reports
        ?.slice(1)
        .every((report) =>
          report.reactions?.every((reaction) => reaction.causeRefs.length > 0),
        ),
    ).toBe(true);
  }, FOUR_YEAR_RUN_TIMEOUT_MS);

  it("stops a critical month, saves the response, and fails if it stays unresolved", async () => {
    const storage = memory();
    const initial = await createGame(
      storage.repository,
      "first-playable-crisis",
    );
    storage.replace({
      ...initial,
      economy: {
        ...initial.economy,
        sentiment: { ...initial.economy.sentiment, support: scorePoint(1) },
      },
    });
    const crisis = await advanceMonth(storage.repository, 1);
    expect(crisis.runState).toBe("crisisStopped");
    expect(crisis.crisisCounters.unresolved).toBe(1);
    await expect(advanceMonth(storage.repository, 1)).rejects.toThrow(
      /危機への対応中/,
    );
    const resumed = await resumeCrisis(storage.repository, 1);
    expect(resumed.runState).toBe("paused");
    const failed = await advanceMonth(storage.repository, 1);
    expect(failed.runState).toBe("failed");
    expect(evaluateEnding(failed).rank).toBe("F");
  });

  it("persists one event choice and keeps its mitigation separate", async () => {
    const storage = memory();
    const initial = await createGame(storage.repository, "event-choice");
    storage.replace({
      ...initial,
      runState: "awaitingEvent",
      events: {
        ...initial.events,
        activeEventIds: ["evt-demand-slump"],
        pendingChoiceEventId: "evt-demand-slump",
        occurrences: [
          {
            eventId: "evt-demand-slump",
            occurredMonth: 0,
            preparedness: 0.5,
            baselineDamage: -2,
            preparednessMitigation: 0.5,
            choiceMitigation: 0,
            targetPath: "economy.indices.realGdp",
          },
        ],
      },
    });
    const resolved = await resolveEvent(storage.repository, 1, "balanced");
    expect(resolved.runState).toBe("paused");
    expect(resolved.events.pendingChoiceEventId).toBeUndefined();
    expect(resolved.events.occurrences?.[0]).toMatchObject({
      choiceId: "balanced",
      choiceMitigation: 0.3,
    });
    await expect(
      resolveEvent(storage.repository, 1, "balanced"),
    ).rejects.toThrow(/対応を選ぶイベントがありません/);
  });

  it("matches a twelve-month batch after the same committed policy command", async () => {
    const storage = memory();
    const initial = await createGame(
      storage.repository,
      "first-playable-policy",
    );
    const preview = previewPolicy({
      state: initial,
      draft: {
        status: "draft",
        policyId: "chosen-rate",
        ruleId: "interest-rate",
        value: 0.05,
        quartersAhead: 0,
      },
      horizonMonths: 12,
    });
    const committed = await confirmPolicy(
      storage.repository,
      1,
      {
        kind: "commit",
        commandId: "decision-1",
        expectedStateHash: preview.stateHash,
        draft: preview.previewedDraft!,
      },
      {
        expertIds: ["macro", "fiscal"],
        confidence: "medium",
        uncertainty: "固定ショック幅",
        summaries: [
          { horizonMonths: 12, indicatorId: "realGdp", endDelta: 1 },
          { horizonMonths: 60, indicatorId: "realGdp", endDelta: 2 },
        ],
      },
    );
    expect(committed.history.forecastRecords).toEqual([
      expect.objectContaining({
        recordId: "forecast:decision-1",
        expertIds: ["macro", "fiscal"],
        horizons: [
          { months: 12, indicators: { realGdp: 1 } },
          { months: 60, indicators: { realGdp: 2 } },
        ],
      }),
    ]);
    const batch = runPolicyHeadless({
      initialState: { ...committed, runState: "running" },
      tickCount: 12,
    });
    expect(batch.failure).toBeNull();
    let sequential = committed;
    for (let month = 0; month < 12; month += 1)
      sequential = await advanceMonth(storage.repository, 1);
    expect(sequential.economy).toEqual(batch.finalState.economy);
    expect(sequential.rng).toEqual(batch.finalState.rng);
    expect(sequential.policies).toEqual(batch.finalState.policies);
    expect(sequential.effects).toEqual(batch.finalState.effects);
  }, YEAR_RUN_TIMEOUT_MS);
});
