import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { GameState } from "@macro-nation/domain";
import { policyStateHash } from "@macro-nation/simulation-engine";
import { advanceMonth, createGame } from "../application/game-service";
import { unlockedScenarioIds } from "../application/scenario-progression";
import { IndexedDbGameRepository } from "./game-repository";

async function replaceCurrentWithCorrupt(factory: IDBFactory, current: unknown = { slotId: 1 }) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("macro-nation-games");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("slots", "readwrite");
    const store = transaction.objectStore("slots");
    const request = store.get(1);
    request.onsuccess = () =>
      store.put({ ...request.result, current });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

describe("IndexedDbGameRepository generations", () => {
  it("reloads full causal history and recovers when schema 5 trace data is corrupt", async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbGameRepository(factory);
    const initial = await createGame(repository, "causal-repository-reload");
    const advanced = await advanceMonth(repository, 1);
    const reloaded = new IndexedDbGameRepository(factory);
    expect((await reloaded.load(1))?.history.reports).toEqual(advanced.history.reports);
    for (const causalTrace of [undefined, {
      completeness: "complete",
      indicators: [{
        ...advanced.history.reports!.at(-1)!.causalTrace!.indicators[0],
        afterValue: Number.NaN,
      }],
    }]) {
      await replaceCurrentWithCorrupt(factory, {
        ...advanced,
        history: {
          ...advanced.history,
          reports: advanced.history.reports!.map((report) => report.monthIndex === 1
            ? { ...report, causalTrace } : report),
        },
      });
      const recovered = await reloaded.loadSlot(1);
      expect(recovered.recovered).toBe(true);
      expect(recovered.state).toEqual(initial);
    }
  });

  it("aborts a queued write when its selected game is no longer active", async () => {
    const repository = new IndexedDbGameRepository(new IDBFactory());
    const initial = await createGame(repository, "guarded-save");
    await expect(
      repository.save(
        policyStateHash(initial),
        {
          ...initial,
          learningMode: "standard",
        },
        () => false,
      ),
    ).rejects.toThrow(/切り替わり/);
    expect(await repository.load(1)).toEqual(initial);
    await repository.save(
      policyStateHash(initial),
      {
        ...initial,
        learningMode: "standard",
      },
      () => true,
    );
    expect((await repository.load(1))?.learningMode).toBe("standard");
  });
  it("keeps start commands idempotent and recovers a corrupt current generation", async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbGameRepository(factory);
    const initial = await createGame(
      repository,
      "recoverable",
      1,
      "learning",
      "long",
      "standard",
      "start-command-1",
    );
    await repository.save(policyStateHash(initial), {
      ...initial,
      learningMode: "standard",
    });
    await expect(
      repository.create(initial, "start-command-1"),
    ).resolves.toBeUndefined();
    expect((await repository.load(1))?.gameId).toBe(initial.gameId);
    await expect(
      repository.create({ ...initial, gameId: "different" }, "new-command"),
    ).rejects.toThrow(/exists/);

    await replaceCurrentWithCorrupt(factory);
    const recovered = await repository.loadSlot(1);
    expect(recovered.recovered).toBe(true);
    expect(recovered.reason).toMatch(/読み込めなかった.*直前/);
    expect(recovered.reason).toContain("進んだ月や政策を確認しましょう");
    expect(recovered.state?.durationMode).toBe("long");
    expect(recovered.state?.difficulty).toBe("standard");
  });
});

function completed(state: GameState): GameState {
  return {
    ...state,
    monthIndex: state.clock.endMonth ?? 48,
    runState: "completed",
    clock: { ...state.clock, stopReason: "completed" },
  };
}

async function legacySlot(factory: IDBFactory, value: unknown) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("macro-nation-games", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("slots", { keyPath: "slotId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("slots", "readwrite");
    transaction.objectStore("slots").add(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

describe("durable scenario progression", () => {
  it("unlocks both scenarios atomically and preserves progress after reload and slot replacement", async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbGameRepository(factory);
    expect(unlockedScenarioIds(await repository.loadProgression())).toEqual([
      "SCN-01",
    ]);
    const initial = await createGame(repository, "completed-scn01");
    const snapshot = structuredClone(initial.configSnapshot);
    const finished = completed(initial);
    await repository.save(policyStateHash(initial), finished);
    expect((await repository.load(1))?.configSnapshot).toEqual(snapshot);
    // No progression read happens between completion and deletion: this must
    // retain the profile written by the completion transaction itself.
    await repository.delete(1);
    await createGame(repository, "replacement-scn01");
    const reloaded = new IndexedDbGameRepository(factory);
    expect(await reloaded.loadProgression()).toEqual({
      completedScenarioIds: ["SCN-01"],
    });
    expect(unlockedScenarioIds(await reloaded.loadProgression())).toEqual([
      "SCN-01",
      "SCN-02",
      "SCN-03",
    ]);
    expect((await reloaded.load(1))?.runState).toBe("paused");
  });

  it("grants no unlock for failure, stale writes, or cancelled writes", async () => {
    const repository = new IndexedDbGameRepository(new IDBFactory());
    const initial = await createGame(repository, "unlock-save-guards");
    await expect(
      repository.save("stale-state", completed(initial)),
    ).rejects.toThrow(/changed/);
    await expect(
      repository.save(
        policyStateHash(initial),
        completed(initial),
        () => false,
      ),
    ).rejects.toThrow(/切り替わり/);
    const failed: GameState = { ...completed(initial), runState: "failed" };
    await repository.save(policyStateHash(initial), failed);
    expect(await repository.loadProgression()).toEqual({
      completedScenarioIds: [],
    });
    expect(unlockedScenarioIds(await repository.loadProgression())).toEqual([
      "SCN-01",
    ]);
    expect((await repository.load(1))?.runState).toBe("failed");
  });

  it.each(["raw", "current", "previous"])(
    "backfills a legacy %s completed slot while preserving the saved scenario snapshot",
    async (generation) => {
      const initial = await createGame(
        new IndexedDbGameRepository(new IDBFactory()),
        "legacy-unlock",
      );
      const finished = completed(initial);
      const factory = new IDBFactory();
      await legacySlot(
        factory,
        generation === "raw"
          ? finished
          : {
              slotId: 1,
              current: generation === "current" ? finished : { slotId: 1 },
              ...(generation === "previous" ? { previous: finished } : {}),
            },
      );
      const repository = new IndexedDbGameRepository(factory);
      expect(await repository.loadProgression()).toEqual({
        completedScenarioIds: ["SCN-01"],
      });
      expect(await repository.load(1)).toEqual(finished);
      await repository.delete(1);
      expect(
        unlockedScenarioIds(
          await new IndexedDbGameRepository(factory).loadProgression(),
        ),
      ).toEqual(["SCN-01", "SCN-02", "SCN-03"]);
    },
  );

  it("records a completed imported run during creation without granting progress on rejected creation", async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbGameRepository(factory);
    const initial = await createGame(repository, "occupied-slot");
    await expect(repository.create(completed(initial))).rejects.toThrow(
      /exists/,
    );
    expect(await repository.loadProgression()).toEqual({
      completedScenarioIds: [],
    });
    await repository.delete(1);
    await repository.create(completed(initial));
    await repository.delete(1);
    expect(
      await new IndexedDbGameRepository(factory).loadProgression(),
    ).toEqual({ completedScenarioIds: ["SCN-01"] });
  });

  it("retains a legacy completion when its slot is deleted before the first progression read", async () => {
    const initial = await createGame(
      new IndexedDbGameRepository(new IDBFactory()),
      "legacy-delete",
    );
    const factory = new IDBFactory();
    await legacySlot(factory, completed(initial));
    const repository = new IndexedDbGameRepository(factory);
    await repository.delete(1);
    expect(await repository.load(1)).toBeNull();
    expect(
      await new IndexedDbGameRepository(factory).loadProgression(),
    ).toEqual({ completedScenarioIds: ["SCN-01"] });
  });

  it("retains a legacy completion when a slot is replaced before the first progression read", async () => {
    const initial = await createGame(
      new IndexedDbGameRepository(new IDBFactory()),
      "legacy-replace",
    );
    const finished = completed(initial);
    const factory = new IDBFactory();
    await legacySlot(factory, finished);
    const repository = new IndexedDbGameRepository(factory);
    await repository.save(policyStateHash(finished), initial);
    expect(await repository.load(1)).toEqual(initial);
    expect(
      await new IndexedDbGameRepository(factory).loadProgression(),
    ).toEqual({ completedScenarioIds: ["SCN-01"] });
  });

  it("rolls back the completed slot write when its profile cannot be persisted safely", async () => {
    const factory = new IDBFactory();
    const repository = new IndexedDbGameRepository(factory);
    const initial = await createGame(repository, "atomic-profile-rollback");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("macro-nation-games");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("profile", "readwrite");
      transaction.objectStore("profile").put({
        id: "scenario-progression",
        schemaVersion: 99,
        completedScenarioIds: [],
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    await expect(
      repository.save(policyStateHash(initial), completed(initial)),
    ).rejects.toThrow();
    expect(await repository.load(1)).toEqual(initial);
    await expect(repository.loadProgression()).rejects.toThrow(/解放情報/);
  });
});
