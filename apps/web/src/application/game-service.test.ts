import { describe, expect, it } from "vitest";
import { scorePoint, type GameState } from "@macro-nation/domain";
import {
  policyStateHash,
  previewPolicy,
  runPolicyHeadless,
} from "@macro-nation/simulation-engine";
import {
  advanceMonth,
  confirmPolicy,
  createGame,
  evaluateEnding,
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
