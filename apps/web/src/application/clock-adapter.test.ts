import { describe, expect, it } from "vitest";
import type { GameState } from "@macro-nation/domain";
import { checkpointClock } from "./clock-adapter";
import { createGame, type GameRepository } from "./game-service";

async function fixture(): Promise<GameState> {
  let saved: GameState | null = null;
  const repository: GameRepository = {
    async load() {
      return saved;
    },
    async create(state) {
      saved = state;
    },
    async save(_expected, state) {
      saved = state;
    },
  };
  const state = await createGame(repository, "clock-warning", 1, "casual");
  return {
    ...state,
    runState: "running",
    clock: {
      ...state.clock,
      progressionMode: "auto",
      lastProcessedWallClockMs: 1_000_000,
      remainderMs: 123,
    },
  };
}

describe("wall-clock notices", () => {
  it("retains the checkpoint and fraction through backward time and resumes only after it catches up", async () => {
    const initial = await fixture();
    const backward = checkpointClock(initial, 900_000);
    expect(backward.clock.warning).toBe("CLOCK_MOVED_BACKWARD");
    expect(backward.clock.lastProcessedWallClockMs).toBe(1_000_000);
    expect(backward.clock.remainderMs).toBe(123);
    expect(backward.pendingOfflineSteps).toBe(0);
    expect(backward.economy).toEqual(initial.economy);
    expect(backward.rng).toEqual(initial.rng);
    expect(checkpointClock(backward, 999_999)).toEqual(backward);

    const recovered = checkpointClock(backward, 1_000_000);
    expect(recovered.clock.warning).toBeUndefined();
    expect(recovered.clock.remainderMs).toBe(123);
    expect(recovered.pendingOfflineSteps).toBe(0);
    const elapsed = checkpointClock(recovered, 1_300_000);
    expect(elapsed.pendingOfflineSteps).toBe(1);
    expect(elapsed.clock.remainderMs).toBe(123);
  });

  it("leaves manual and stopped games unchanged when the device clock moves backward", async () => {
    const running = await fixture();
    for (const state of [
      { ...running, runState: "paused" } as const,
      {
        ...running,
        clock: { ...running.clock, progressionMode: "manual" },
      } as const,
    ])
      expect(checkpointClock(state, 0)).toBe(state);
  });
});
