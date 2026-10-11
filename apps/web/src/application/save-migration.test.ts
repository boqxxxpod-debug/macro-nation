import { describe, expect, it } from "vitest";
import { sha256Hex, stableStringify } from "@macro-nation/model-config";
import type { GameState } from "@macro-nation/domain";
import {
  ENGINE_VERSION,
  policyStateHash,
} from "@macro-nation/simulation-engine";
import { advanceMonth, createGame, type GameRepository } from "./game-service";
import { migrateFirstPlayableSave } from "./save-migration";

describe("first playable save migration", () => {
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
      expect(migrated.versions.saveSchemaVersion).toBe("3");
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
      },
    };
    stored = structuredClone(old);
    const migrated = await migrateFirstPlayableSave(repository, old);
    expect(migrated.economy).toEqual(old.economy);
    expect(migrated.rng).toEqual(old.rng);
    expect(migrated.versions.engineVersion).toBe(ENGINE_VERSION);
    expect(migrated.durationMode).toBe("short");
    expect(migrated.clock.endMonth).toBe(48);
    expect(migrated.versions.saveSchemaVersion).toBe("3");
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
