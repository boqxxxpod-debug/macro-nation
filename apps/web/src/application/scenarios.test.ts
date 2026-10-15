import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { GameState } from "@macro-nation/domain";
import {
  policyStateHash,
  runPolicyHeadless,
} from "@macro-nation/simulation-engine";
import { IndexedDbGameRepository } from "../infrastructure/game-repository";
import { calculateMonth, createGame } from "./game-service";

describe("scenario start and saved configuration", () => {
  it("enforces the completion gate outside the UI without writing a locked game", async () => {
    const repository = new IndexedDbGameRepository(new IDBFactory());
    const state = await createGame(repository, "unfinished-scn01");
    for (const scenarioId of ["SCN-02", "SCN-03"] as const) {
      await expect(
        createGame(
          repository,
          "locked",
          2,
          "standard",
          "standard",
          "standard",
          undefined,
          scenarioId,
        ),
      ).rejects.toThrow(/SCN-01を完了/);
      expect(await repository.load(2)).toBeNull();
    }
    await repository.save(policyStateHash(state), {
      ...state,
      runState: "failed",
    });
    await expect(
      createGame(
        repository,
        "failed-is-not-complete",
        2,
        "standard",
        "standard",
        "standard",
        undefined,
        "SCN-02",
      ),
    ).rejects.toThrow(/SCN-01を完了/);
  });

  it.each(["SCN-02", "SCN-03"] as const)(
    "starts and reloads %s with its own fixed snapshot",
    async (scenarioId) => {
      const factory = new IDBFactory();
      const repository = new IndexedDbGameRepository(factory);
      const first = await createGame(repository, "completed-scn01");
      await repository.save(policyStateHash(first), {
        ...first,
        runState: "completed",
      });
      const selected = await createGame(
        repository,
        "scenario-roundtrip",
        2,
        "casual",
        "long",
        "expert",
        "start-scenario",
        scenarioId,
      );
      expect(selected).toMatchObject({
        scenarioId,
        difficulty: "expert",
        durationMode: "long",
        learningMode: "casual",
        rng: { rootSeed: "scenario-roundtrip" },
        clock: { endMonth: 240 },
        configSnapshot: { normalizedConfig: { scenario: { id: scenarioId } } },
      });
      const reloaded = await new IndexedDbGameRepository(factory).load(2);
      expect(reloaded).toEqual(selected);
      const next = calculateMonth(reloaded!);
      const batch = runPolicyHeadless({
        initialState: { ...selected, runState: "running" },
        tickCount: 1,
        deriveReactions: true,
      });
      expect(batch.failure).toBeNull();
      expect(next.economy).toEqual(batch.finalState.economy);
      expect(next.rng).toEqual(batch.finalState.rng);
      expect(next.configSnapshot).toEqual(selected.configSnapshot);
      await repository.save(policyStateHash(selected), next);
      expect(await new IndexedDbGameRepository(factory).load(2)).toEqual(next);
      const retry = await createGame(
        repository,
        "scenario-roundtrip",
        2,
        "casual",
        "long",
        "expert",
        "start-scenario",
        scenarioId,
      );
      expect(retry).toEqual(next);
      await expect(
        createGame(
          repository,
          "scenario-roundtrip",
          2,
          "casual",
          "long",
          "expert",
          "start-scenario",
          scenarioId === "SCN-02" ? "SCN-03" : "SCN-02",
        ),
      ).rejects.toThrow(/different start settings/);
      expect(await repository.load(2)).toEqual(next);
    },
  );

  it("uses 48 months for the introduction and 96 months for a standard scenario when omitted", async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbGameRepository(factory);
    const first = await createGame(repository, "default-duration");
    expect(first.clock.endMonth).toBe(48);
    await repository.save(policyStateHash(first), {
      ...first,
      runState: "completed",
    } as GameState);
    for (const scenarioId of ["SCN-02", "SCN-03"] as const) {
      const next = await createGame(
        repository,
        "default-duration",
        scenarioId === "SCN-02" ? 2 : 3,
        "learning",
        undefined,
        "intro",
        undefined,
        scenarioId,
      );
      expect(next.clock.endMonth).toBe(96);
      expect(next.durationMode).toBe("standard");
    }
  });
});
