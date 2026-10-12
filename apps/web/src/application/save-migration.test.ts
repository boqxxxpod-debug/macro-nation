import { describe, expect, it } from "vitest";
import { sha256Hex, stableStringify } from "@macro-nation/model-config";
import type { GameState } from "@macro-nation/domain";
import {
  ENGINE_VERSION,
  policyStateHash,
} from "@macro-nation/simulation-engine";
import { advanceMonth, createGame, type GameRepository } from "./game-service";
import { migrateFirstPlayableSave } from "./save-migration";

function migrationStorage() {
  let stored: GameState | null = null;
  let saves = 0;
  const repository: GameRepository = {
    async load() { return stored ? structuredClone(stored) : null; },
    async create(state) { stored = structuredClone(state); },
    async save(expected, next) {
      if (!stored || policyStateHash(stored) !== expected) throw new Error("stale");
      stored = structuredClone(next);
      saves += 1;
    },
  };
  return {
    repository,
    replace(state: GameState) { stored = structuredClone(state); },
    get saves() { return saves; },
  };
}

describe("first playable save migration", () => {
  it("creates schema 4 learning history and reopens it without another save", async () => {
    const storage = migrationStorage();
    const current = await createGame(storage.repository, "learning-schema-4");
    expect(current.versions.saveSchemaVersion).toBe("4");
    expect(current.history.learningEntries).toEqual([]);
    expect(await migrateFirstPlayableSave(storage.repository, current)).toBe(current);
    expect(storage.saves).toBe(0);
  });

  it("rejects non-array learning history without overwriting the original save", async () => {
    const storage = migrationStorage();
    const current = await createGame(storage.repository, "corrupt-learning-history");
    for (const saveSchemaVersion of ["3", "4"]) {
      for (const learningEntries of [null, "invalid", {}]) {
        const corrupted: GameState = {
          ...current,
          history: { ...current.history, learningEntries } as unknown as GameState["history"],
          versions: { ...current.versions, saveSchemaVersion },
        };
        storage.replace(corrupted);
        await expect(migrateFirstPlayableSave(storage.repository, corrupted))
          .rejects.toThrow(/学習履歴の形式/);
        expect(await storage.repository.load(1)).toEqual(corrupted);
      }
    }
    expect(storage.saves).toBe(0);
  });

  it.each(["1", "2", "3"])(
    "migrates a schema %s save without learning history and preserves its economic run",
    async (saveSchemaVersion) => {
      const storage = migrationStorage();
      const current = await createGame(storage.repository, "learning-legacy", 1, "learning", "long");
      const { learningEntries, ...legacyHistory } = current.history;
      expect(learningEntries).toEqual([]);
      const clock = { ...current.clock };
      if (saveSchemaVersion === "1") {
        delete clock.endMonth;
        delete clock.durationMode;
      }
      if (saveSchemaVersion !== "3") {
        delete clock.progressionMode;
        delete clock.lastProcessedWallClockMs;
        delete clock.remainderMs;
        delete clock.stopReason;
      }
      const legacy: GameState = {
        ...current,
        clock,
        history: legacyHistory,
        pendingOfflineSteps: 17,
        versions: { ...current.versions, saveSchemaVersion },
      };
      storage.replace(legacy);
      const migrated = await migrateFirstPlayableSave(storage.repository, legacy);
      expect(migrated.versions).toEqual({ ...legacy.versions, saveSchemaVersion: "4" });
      expect(migrated.history.learningEntries).toEqual([]);
      expect(migrated.configSnapshot).toEqual(legacy.configSnapshot);
      expect(migrated.economy).toEqual(legacy.economy);
      expect(migrated.rng).toEqual(legacy.rng);
      expect(migrated.pendingOfflineSteps).toBe(17);
      expect(migrated.learningMode).toBe("learning");
      expect(migrated.clock.endMonth).toBe(saveSchemaVersion === "1" ? 48 : 240);
      expect(migrated.durationMode).toBe(saveSchemaVersion === "1" ? "short" : "long");
      expect(await storage.repository.load(1)).toEqual(migrated);
      expect(await migrateFirstPlayableSave(storage.repository, migrated)).toBe(migrated);
      expect(storage.saves).toBe(1);
      const next = await advanceMonth(storage.repository, 1);
      expect(next.monthIndex).toBe(1);
      expect(next.history.learningEntries?.length).toBeGreaterThan(0);
    },
  );

  it("keeps a schema 3 game's auto clock and existing learning records", async () => {
    const storage = migrationStorage();
    const current = await createGame(storage.repository, "learning-clock-3", 1, "standard", "long");
    const legacy: GameState = {
      ...current,
      runState: "running",
      pendingOfflineSteps: 3,
      clock: {
        ...current.clock,
        progressionMode: "auto",
        lastProcessedWallClockMs: 1_000,
        remainderMs: 123,
      },
      history: {
        ...current.history,
        learningEntries: [{
          entryId: "prior-learning-record", month: 0, kind: "verification",
          concept: "指標の変化", evidence: "保存済みの結果検証", mode: "standard",
        }],
      },
      versions: { ...current.versions, saveSchemaVersion: "3" },
    };
    storage.replace(legacy);
    const migrated = await migrateFirstPlayableSave(storage.repository, legacy);
    expect(migrated.versions.saveSchemaVersion).toBe("4");
    expect(migrated.runState).toBe("running");
    expect(migrated.clock).toEqual(legacy.clock);
    expect(migrated.pendingOfflineSteps).toBe(3);
    expect(migrated.history.learningEntries).toEqual(legacy.history.learningEntries);
    expect(migrated.configSnapshot).toEqual(legacy.configSnapshot);
    expect(migrated.economy).toEqual(legacy.economy);
    expect(migrated.rng).toEqual(legacy.rng);
    expect(await migrateFirstPlayableSave(storage.repository, migrated)).toBe(migrated);
    expect(storage.saves).toBe(1);
  });

  it("reuses an identical migration when two startup reads race", async () => {
    let stored: GameState | null = null;
    let commits = 0;
    const repository: GameRepository = {
      async load() { return stored ? structuredClone(stored) : null; },
      async create(state) { stored = structuredClone(state); },
      async save(expected, next) {
        if (!stored || policyStateHash(stored) !== expected) throw new Error("stale");
        stored = structuredClone(next);
        commits += 1;
      },
    };
    const current = await createGame(repository, "concurrent-migration");
    const clock = { ...current.clock };
    delete clock.progressionMode;
    delete clock.lastProcessedWallClockMs;
    delete clock.remainderMs;
    delete clock.stopReason;
    const legacy: GameState = { ...current, clock,
      versions: { ...current.versions, saveSchemaVersion: "2" } };
    stored = structuredClone(legacy);
    const [first, second] = await Promise.all([
      migrateFirstPlayableSave(repository, legacy), migrateFirstPlayableSave(repository, legacy),
    ]);
    expect(second).toEqual(first);
    expect(second).toEqual(stored);
    expect(commits).toBe(1);
  });
  it.each(["running", "paused", "awaitingEvent", "crisisStopped", "completed", "failed"] as const)(
    "migrates a schema 2 %s save to manual without changing its run's configuration",
    async (runState) => {
      let stored: GameState | null = null;
      let saves = 0;
      const repository: GameRepository = {
        async load() { return stored ? structuredClone(stored) : null; },
        async create(state) { stored = structuredClone(state); },
        async save(expected, next) {
          if (!stored || policyStateHash(stored) !== expected) throw new Error("stale");
          stored = structuredClone(next);
          saves += 1;
        },
      };
      const current = await createGame(repository, "schema-2-long", 1, "standard", "long");
      const { progressionMode: _mode, lastProcessedWallClockMs: _anchor,
        remainderMs: _fraction, stopReason: _reason, ...legacyClock } = current.clock;
      expect([_mode, _anchor, _fraction, _reason]).toEqual(["manual", null, 0, "manual"]);
      const legacy: GameState = {
        ...current,
        runState,
        pendingOfflineSteps: 17,
        clock: legacyClock,
        versions: { ...current.versions, saveSchemaVersion: "2" },
      };
      stored = structuredClone(legacy);
      const migrated = await migrateFirstPlayableSave(repository, legacy);
      expect(migrated.runState).toBe(runState === "running" ? "paused" : runState);
      expect(migrated.clock.progressionMode).toBe("manual");
      expect(migrated.clock.lastProcessedWallClockMs).toBeNull();
      expect(migrated.clock.remainderMs).toBe(0);
      expect(migrated.clock.endMonth).toBe(240);
      expect(migrated.durationMode).toBe("long");
      expect(migrated.pendingOfflineSteps).toBe(17);
      expect(migrated.configSnapshot).toEqual(legacy.configSnapshot);
      expect(migrated.economy).toEqual(legacy.economy);
      expect(migrated.rng).toEqual(legacy.rng);
      expect(migrated.versions.engineVersion).toBe(legacy.versions.engineVersion);
      expect(migrated.versions.saveSchemaVersion).toBe("4");
      expect(await migrateFirstPlayableSave(repository, migrated)).toEqual(migrated);
      expect(saves).toBe(1);
      await expect(migrateFirstPlayableSave(repository, {
        ...migrated, versions: { ...migrated.versions, saveSchemaVersion: "99" },
      })).rejects.toThrow(/版に対応/);
    },
  );
  it("keeps an existing 0.1.7 game and its economic state when only play rules change", async () => {
    let stored: GameState | null = null;
    const repository: GameRepository = {
      async load() {
        return stored ? structuredClone(stored) : null;
      },
      async create(state) {
        stored = structuredClone(state);
      },
      async save(expected, next) {
        if (!stored || policyStateHash(stored) !== expected)
          throw new Error("stale");
        stored = structuredClone(next);
      },
    };
    const current = await createGame(repository, "migration-v1");
    const priorScenario = {
      ...(current.configSnapshot.normalizedConfig.scenario as Record<
        string,
        unknown
      >),
    };
    delete priorScenario.firstPlayable;
    const oldConfig = {
      ...current.configSnapshot.normalizedConfig,
      scenario: priorScenario,
    };
    const old: GameState = {
      ...current,
      durationMode: "standard",
      configSnapshot: {
        ...current.configSnapshot,
        snapshotVersion: "0.1.2",
        normalizedConfig: oldConfig,
        configHash: await sha256Hex(stableStringify(oldConfig)),
      },
      versions: {
        ...current.versions,
        engineVersion: "0.1.7",
        configVersion: "0.1.2",
        saveSchemaVersion: "1",
      },
    };
    stored = structuredClone(old);
    const migrated = await migrateFirstPlayableSave(repository, old);
    expect(migrated.economy).toEqual(old.economy);
    expect(migrated.rng).toEqual(old.rng);
    expect(migrated.versions.engineVersion).toBe(ENGINE_VERSION);
    expect(migrated.durationMode).toBe("short");
    expect(migrated.clock.endMonth).toBe(48);
    expect(migrated.versions.saveSchemaVersion).toBe("4");
    expect((await advanceMonth(repository, 1)).monthIndex).toBe(1);
    await expect(
      migrateFirstPlayableSave(repository, {
        ...old,
        configSnapshot: { ...old.configSnapshot, configHash: "tampered" },
      }),
    ).rejects.toThrow(/整合性/);
  });

  it("preserves a 0.1.8 save's Config Snapshot while adding the SCN-01 end month", async () => {
    let stored: GameState | null = null;
    const repository: GameRepository = {
      async load() {
        return stored;
      },
      async create(state) {
        stored = state;
      },
      async save(expected, next) {
        if (!stored || policyStateHash(stored) !== expected)
          throw new Error("stale");
        stored = next;
      },
    };
    const current = await createGame(repository, "old-save");
    const oldClock = {
      stepIndex: current.clock.stepIndex,
      year: current.clock.year,
      month: current.clock.month,
      config: current.clock.config,
    };
    const old: GameState = {
      ...current,
      clock: oldClock,
      versions: {
        ...current.versions,
        engineVersion: "0.1.8",
        saveSchemaVersion: "1",
      },
    };
    stored = old;
    const migrated = await migrateFirstPlayableSave(repository, old);
    expect(migrated.clock.endMonth).toBe(48);
    expect(migrated.configSnapshot).toEqual(old.configSnapshot);
    expect(migrated.economy).toEqual(old.economy);
    expect((await advanceMonth(repository, 1)).monthIndex).toBe(1);
  });
});
