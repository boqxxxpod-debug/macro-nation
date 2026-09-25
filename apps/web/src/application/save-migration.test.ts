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
    expect((await advanceMonth(repository, 1)).monthIndex).toBe(1);
    await expect(
      migrateFirstPlayableSave(repository, {
        ...old,
        configSnapshot: { ...old.configSnapshot, configHash: "tampered" },
      }),
    ).rejects.toThrow(/整合性/);
  });
});
