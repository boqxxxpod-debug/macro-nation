import { describe, expect, it } from "vitest";
import { scorePoint, type GameState } from "@macro-nation/domain";
import {
  policyStateHash,
  previewPolicy,
  runPolicyHeadless,
} from "@macro-nation/simulation-engine";
import {
  advanceMonth,
  catchUpOffline,
  confirmPolicy,
  createGame,
  evaluateEnding,
  resolveEvent,
  resumeCrisis,
  type GameRepository,
} from "./game-service";

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
    const storage = memory();
    const initial = await createGame(
      storage.repository,
      "baseline-96",
      1,
      "learning",
      "long",
    );
    expect(initial.clock.endMonth).toBe(240);
    storage.replace({ ...initial, runState: "running" });
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
    expect(progress).toEqual([12, 24, 36, 48, 60, 72, 84, 96]);
    const resumed = await catchUpOffline(storage.repository, 1, 0);
    expect(resumed.monthIndex).toBe(100);
    expect(resumed.pendingOfflineSteps).toBe(0);
    expect(resumed.clock.endMonth).toBe(240);
    expect(
      (await storage.repository.load(1))?.history.reviews?.map(
        (item) => item.monthIndex,
      ),
    ).toEqual([60]);
  }, 15_000);

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
  });

  it("persists the same 48-month save after four offline hours as sequential progress", async () => {
    const sequentialStorage = memory();
    const offlineStorage = memory();
    const sequentialInitial = await createGame(
      sequentialStorage.repository,
      "first-playable-offline-equivalence",
    );
    const offlineInitial = await createGame(
      offlineStorage.repository,
      "first-playable-offline-equivalence",
    );

    let sequential = sequentialInitial;
    for (let month = 0; month < 48; month += 1)
      sequential = await advanceMonth(sequentialStorage.repository, 1);

    offlineStorage.replace({ ...offlineInitial, runState: "running" });
    const offline = await catchUpOffline(
      offlineStorage.repository,
      1,
      4 * 60 * 60,
    );

    expect(offline).toEqual(sequential);
    expect(offline.history.reports).toHaveLength(49);
    expect(
      offline.history.reports
        ?.slice(1)
        .every((report) =>
          report.reactions?.every((reaction) => reaction.causeRefs.length > 0),
        ),
    ).toBe(true);
  });

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
      /危機停止/,
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
    ).rejects.toThrow(/選択待ち/);
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
    const committed = await confirmPolicy(storage.repository, 1, {
      kind: "commit",
      commandId: "decision-1",
      expectedStateHash: preview.stateHash,
      draft: preview.previewedDraft!,
    });
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
  });
});
